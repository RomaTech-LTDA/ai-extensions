import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  useAi,
  AiExposureLevel,
  CircuitState,
  McpAuditLog,
  McpRequestHandler,
  McpToolExecutor,
  McpToolHttpError,
  McpToolRegistry,
  McpResourceRegistry,
  MetadataDiscoveryProvider,
  NullLogger,
  PACKAGE_VERSION,
  SlidingWindowRateLimiter,
  MAX_ERROR_BODY_CHARS,
  createFastifyMcpPlugin,
  createKoaMcpMiddleware,
  createLambdaMcpHandler,
  createMcpMiddleware,
  createNestMcpController,
  createNextjsAppMcpHandler,
  createNextjsMcpHandler,
  createSseTransport,
  createWsMcpHandler,
  rateLimitClientKey,
  registerAiMetadata,
  aiTool,
} from '../src';
import type { AiEndpointDescriptor } from '../src/shared/models';
import type { McpOptions } from '../src/mcp/options';
import { metadataRegistry } from '../src/metadata/registry';

// ─── Helpers ─────────────────────────────────────────────────────────────────────

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

function rpc(method: string, params?: Record<string, unknown>, id: number | undefined = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

function tool(toolName: string, extra: Partial<AiEndpointDescriptor> = {}): AiEndpointDescriptor {
  return {
    toolName, httpMethod: 'POST', route: `/${toolName}`, contextPriority: 0,
    exposureLevel: AiExposureLevel.Executable, ...extra,
  };
}

function makeHandler(endpoints: AiEndpointDescriptor[], options?: McpOptions, baseUrl = 'http://127.0.0.1:1') {
  const executor = new McpToolExecutor(baseUrl, 2_000);
  const handler = new McpRequestHandler(
    new McpToolRegistry({ discoverEndpoints: async () => endpoints }),
    executor,
    new SlidingWindowRateLimiter(),
    options,
  );
  handler.attachLogger(new NullLogger());
  return { handler, executor };
}

const call = (name: string, args: Record<string, unknown> = {}) =>
  ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const toolNames = (response: any) => (response.result.tools as { name: string }[]).map((t) => t.name);

// ─── Secure by default ───────────────────────────────────────────────────────────

describe('secure by default: the MCP endpoint is never anonymous by accident', () => {
  const { handler } = makeHandler([]);
  const factories: Record<string, (options?: McpOptions) => unknown> = {
    'createMcpMiddleware': (o) => createMcpMiddleware(handler, o),
    'createFastifyMcpPlugin': (o) => createFastifyMcpPlugin(handler, o),
    'createKoaMcpMiddleware': (o) => createKoaMcpMiddleware(handler, o),
    'createLambdaMcpHandler': (o) => createLambdaMcpHandler(handler, o),
    'createNextjsMcpHandler': (o) => createNextjsMcpHandler(handler, o),
    'createNextjsAppMcpHandler': (o) => createNextjsAppMcpHandler(handler, o),
    'createNestMcpController': (o) => createNestMcpController(handler, o),
    'createSseTransport': (o) => createSseTransport(handler, o),
    'createWsMcpHandler': (o) => createWsMcpHandler(handler, o),
    'useAi': (o) => useAi(express(), { mcp: o, logger: new NullLogger(), discoveryProvider: new MetadataDiscoveryProvider() }),
  };

  for (const [name, create] of Object.entries(factories)) {
    it(`${name} refuses to start without apiKey, authenticate or allowAnonymous`, () => {
      expect(() => create(undefined)).toThrow(/requires authentication/);
      expect(() => create({ apiKey: '' })).toThrow(/requires authentication/);
      expect(() => create({ apiKey: 'k' })).not.toThrow();
      expect(() => create({ authenticate: () => true })).not.toThrow();
      expect(() => create({ allowAnonymous: true })).not.toThrow();
    });
  }
});

describe('authentication on the HTTP endpoint', () => {
  let server: Server;
  let url: string;
  const resolveRoles = vi.fn((context: any) => (context.principal?.roles ?? []) as string[]);

  beforeAll(async () => {
    metadataRegistry.clear();
    registerAiMetadata('POST', '/noop', aiTool('noop'));
    registerAiMetadata('POST', '/admin_only', aiTool({ toolName: 'admin_only', role: 'admin' }));
    const app = express();
    app.use(express.json());
    ({ server, url } = await listen(app));
    const services = useAi(app, {
      baseUrl: url,
      discoveryProvider: new MetadataDiscoveryProvider(),
      logger: new NullLogger(),
      mcp: {
        apiKey: 'mcp-key',
        authenticate: (req) => {
          const user = req.header('x-user');
          if (user === 'boom') throw new Error('identity provider down: secret-detail');
          return user ? { name: user, roles: user === 'root' ? ['admin'] : [] } : null;
        },
        resolveRoles,
      },
    });
    services.mcpExecutor.registerHandler('noop', () => 'ok');
    services.mcpExecutor.registerHandler('admin_only', (_args, context) => (context?.principal as any)?.name);
  });

  afterAll(() => close(server));

  const post = (body: string, headers: Record<string, string>) =>
    fetch(`${url}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

  it('rejects a request without the API key (401)', async () => {
    expect((await post(rpc('tools/list'), { 'x-user': 'alice' })).status).toBe(401);
  });

  it('rejects a request whose authenticate hook returns nothing (401)', async () => {
    expect((await post(rpc('tools/list'), { Authorization: 'Bearer mcp-key' })).status).toBe(401);
  });

  it('treats a throwing authenticate hook as a rejection without leaking its message', async () => {
    const res = await post(rpc('tools/list'), { Authorization: 'Bearer mcp-key', 'x-user': 'boom' });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('secret-detail');
  });

  it('accepts a request that passes both the API key and the hook', async () => {
    const res = await post(rpc('tools/call', { name: 'noop', arguments: {} }), { Authorization: 'Bearer mcp-key', 'x-user': 'alice' });
    expect(res.status).toBe(200);
    expect((await res.json()).result.isError).toBeFalsy();
  });

  it('passes the authenticated principal to resolveRoles and to in-process handlers', async () => {
    const res = await post(rpc('tools/call', { name: 'admin_only', arguments: {} }), { Authorization: 'Bearer mcp-key', 'x-user': 'root' });
    const json = await res.json();
    expect(JSON.parse(json.result.content[0].text)).toBe('root');
    expect(resolveRoles).toHaveBeenCalledWith(expect.objectContaining({ principal: { name: 'root', roles: ['admin'] } }));
  });

  it('refuses a role-restricted tool to an authenticated caller without the role', async () => {
    const listed = await (await post(rpc('tools/list'), { Authorization: 'Bearer mcp-key', 'x-user': 'alice' })).json();
    expect(toolNames(listed)).not.toContain('admin_only');
    const called = await (await post(rpc('tools/call', { name: 'admin_only', arguments: {} }), { Authorization: 'Bearer mcp-key', 'x-user': 'alice' })).json();
    expect(called.error?.code).toBe(-32602);
  });

  it('answers a notification with 202 and an empty body', async () => {
    const res = await post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), { Authorization: 'Bearer mcp-key', 'x-user': 'alice' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });
});

// ─── Roles (@AiRole / aiTool({ role })) ──────────────────────────────────────────

describe('role enforcement fails closed', () => {
  const endpoints = [tool('open_tool'), tool('admin_tool', { requiredRole: 'admin' }), tool('ops_tool', { requiredRole: 'admin, ops' })];

  function withHandlers(options?: McpOptions) {
    const made = makeHandler(endpoints, options);
    for (const e of endpoints) made.executor.registerHandler(e.toolName, () => 'ran');
    return made.handler;
  }

  it('hides and refuses role-restricted tools when no resolveRoles is configured', async () => {
    const handler = withHandlers();
    expect(toolNames(await handler.handle(list))).toEqual(['open_tool']);
    expect((await handler.handle(call('admin_tool')))!.error?.code).toBe(-32602);
    expect((await handler.handle(call('open_tool')))!.error).toBeUndefined();
  });

  it('allows a tool when the resolver returns one of the listed roles', async () => {
    const handler = withHandlers({ resolveRoles: () => ['ops'] });
    expect(toolNames(await handler.handle(list))).toEqual(['open_tool', 'ops_tool']);
    expect((await handler.handle(call('ops_tool')))!.error).toBeUndefined();
    expect((await handler.handle(call('admin_tool')))!.error?.code).toBe(-32602);
  });

  it('denies role-restricted tools when the resolver throws', async () => {
    const handler = withHandlers({ resolveRoles: () => { throw new Error('directory down'); } });
    expect(toolNames(await handler.handle(list))).toEqual(['open_tool']);
    expect((await handler.handle(call('admin_tool')))!.error?.code).toBe(-32602);
  });

  it('filters role-restricted resources and rag_search results', async () => {
    const readOnly = [
      { ...tool('public_list'), httpMethod: 'GET', route: '/public', exposureLevel: AiExposureLevel.ReadOnly },
      { ...tool('admin_list'), httpMethod: 'GET', route: '/admin', exposureLevel: AiExposureLevel.ReadOnly, requiredRole: 'admin' },
    ];
    const { handler } = makeHandler(readOnly);
    handler.attachResources(new McpResourceRegistry({ discoverEndpoints: async () => readOnly }));
    handler.attachRagSearch({
      search: async () => readOnly.map((e) => ({ score: 1, document: { ...e, priority: 0 } })),
    } as any);

    const resources = (await handler.handle({ jsonrpc: '2.0', id: 1, method: 'resources/list' }))!.result as any;
    expect(resources.resources.map((r: any) => r.uri)).toEqual(['api:///public']);
    const read = await handler.handle({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'api:///admin' } });
    expect(read!.error?.code).toBe(-32602);
    const rag = await handler.handle(call('rag_search', { query: 'list' }));
    expect(JSON.parse((rag!.result as any).content[0].text).map((r: any) => r.toolName)).toEqual(['public_list']);
  });
});

// ─── WebSocket transport ─────────────────────────────────────────────────────────

describe('WebSocket transport authenticates the upgrade', () => {
  const { handler, executor } = makeHandler([tool('noop')]);
  executor.registerHandler('noop', () => 'ok');
  const ws = createWsMcpHandler(handler, { apiKey: 'ws-key', allowedOrigins: ['https://app.example'] });

  const verify = (headers: Record<string, string>) => new Promise<{ ok: boolean; code?: number }>((resolve) =>
    ws.verifyClient({ req: { headers, method: 'GET' } }, (ok, code) => resolve({ ok, code })));

  it('rejects a cross-site origin with 403 (WebSocket hijacking)', async () => {
    expect(await verify({ origin: 'https://evil.example', authorization: 'Bearer ws-key' })).toEqual({ ok: false, code: 403 });
  });

  it('rejects a missing or wrong API key with 401', async () => {
    expect(await verify({})).toEqual({ ok: false, code: 401 });
    expect(await verify({ authorization: 'Bearer nope' })).toEqual({ ok: false, code: 401 });
  });

  it('accepts a valid upgrade and serves messages with its context', async () => {
    const req = { headers: { origin: 'https://app.example', authorization: 'Bearer ws-key' }, method: 'GET' };
    const result = await new Promise<boolean>((resolve) => ws.verifyClient({ req }, (ok) => resolve(ok)));
    expect(result).toBe(true);
    const response = await ws.handleMessage(rpc('tools/call', { name: 'noop', arguments: {} }), ws.getContext(req));
    expect(response!.error).toBeUndefined();
  });

  it('refuses messages that do not carry an authenticated context', async () => {
    const response = await ws.handleMessage(rpc('tools/list'), { clientId: 'forged' });
    expect(response!.error?.code).toBe(-32001);
  });

  it('still requires an authenticated context when allowAnonymous is combined with apiKey or authenticate', async () => {
    // The HTTP adapters enforce a configured apiKey/authenticate even with allowAnonymous: true;
    // the WebSocket transport must not let unauthenticated messages through in that case.
    for (const options of [
      { apiKey: 'ws-key', allowAnonymous: true },
      { authenticate: () => ({ user: 'u' }), allowAnonymous: true },
    ] as McpOptions[]) {
      const mixed = createWsMcpHandler(handler, options);
      const response = await mixed.handleMessage(rpc('tools/call', { name: 'noop', arguments: {} }));
      expect(response!.error?.code).toBe(-32001);
      expect(response!.result).toBeUndefined();
    }
  });

  it('does not leak exception messages from the handler', async () => {
    const { handler: failing } = makeHandler([]);
    vi.spyOn(failing, 'handle').mockRejectedValue(new Error('db password=hunter2'));
    const anonymous = createWsMcpHandler(failing, { allowAnonymous: true });
    const response = await anonymous.handleMessage(rpc('tools/list'));
    expect(response!.error?.code).toBe(-32603);
    expect(JSON.stringify(response)).not.toContain('hunter2');
  });
});

// ─── NestJS adapter ──────────────────────────────────────────────────────────────

describe('NestJS adapter always validates the request', () => {
  const { handler } = makeHandler([]);
  const nest = createNestMcpController(handler, { apiKey: 'nest-key' });

  it('throws when the request is not passed', async () => {
    await expect(nest.handlePost({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined as any)).rejects.toThrow(TypeError);
  });

  it('rejects a urlencoded cross-site form post with 415 and sets the status', async () => {
    const res = { status: vi.fn(), setHeader: vi.fn() };
    const body = await nest.handlePost(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer nest-key' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(415);
    expect((body as any).error).toBeDefined();
  });

  it('rejects a disallowed Origin and a missing API key', async () => {
    const res = { status: vi.fn() };
    await nest.handlePost({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { 'content-type': 'application/json', origin: 'https://evil.example', authorization: 'Bearer nest-key' } }, res);
    expect(res.status).toHaveBeenLastCalledWith(403);
    await nest.handlePost({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { 'content-type': 'application/json' } }, res);
    expect(res.status).toHaveBeenLastCalledWith(401);
  });
});

// ─── Error bodies and response size ──────────────────────────────────────────────

describe('bounded tool output', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    const api = express();
    api.post('/fails', (_req, res) => { res.status(500).type('text/html').send(`<pre>Error: boom\n${'    at frame (/srv/app.js:1:1)\n'.repeat(500)}</pre>`); });
    api.post('/huge', (_req, res) => { res.type('application/json').send(JSON.stringify({ data: 'x'.repeat(50_000) })); });
    ({ server, url } = await listen(api));
  });

  afterAll(() => close(server));

  it('truncates the error body returned to the client', async () => {
    const { handler } = makeHandler([tool('fails')], undefined, url);
    const response = await handler.handle(call('fails'));
    const text = (response!.result as any).content[0].text as string;
    expect((response!.result as any).isError).toBe(true);
    expect(text.length).toBeLessThan(MAX_ERROR_BODY_CHARS + 200);
    expect(text).toContain('truncated');
  });

  it('stops reading a tool response at maxResponseBytes', async () => {
    const executor = new McpToolExecutor(url, 2_000, { maxResponseBytes: 1_000 });
    const result = await executor.execute(tool('huge'));
    expect(typeof result).toBe('string');
    expect((result as string).length).toBeLessThan(1_100);
    expect(result).toContain('[response truncated: limit 1000 bytes]');
  });
});

// ─── Audit log and circuit breaker are wired into the handler ────────────────────

describe('audit log and circuit breaker', () => {
  it('useAi() returns an audit log that records executions without arguments by default', async () => {
    metadataRegistry.clear();
    registerAiMetadata('POST', '/greet', aiTool('greet'));
    const services = useAi(express(), {
      mcp: { apiKey: 'k' }, logger: new NullLogger(), discoveryProvider: new MetadataDiscoveryProvider(),
    });
    services.mcpExecutor.registerHandler('greet', () => 'hi');
    await services.mcpHandler.handle(call('greet', { password: 'hunter2' }), { clientId: '10.0.0.1' });

    expect(services.auditLog).toBeInstanceOf(McpAuditLog);
    const [entry] = services.auditLog!.getRecent(1);
    expect(entry).toMatchObject({ toolName: 'greet', method: 'tools/call', success: true, clientId: '10.0.0.1' });
    expect(JSON.stringify(entry)).not.toContain('hunter2');
    expect(services.circuitBreaker).toBeUndefined();
  });

  it('records arguments only when includeArguments is enabled', () => {
    const log = new McpAuditLog({ includeArguments: true, maxEntries: 2 });
    for (let i = 0; i < 3; i++) log.record({ toolName: 't', method: 'tools/call', arguments: { i }, durationMs: 0, success: true });
    expect(log.count).toBe(2);
    expect(log.getRecent(1)[0].arguments).toEqual({ i: 2 });
  });

  it('opens the circuit after upstream failures and refuses further calls without executing them', async () => {
    metadataRegistry.clear();
    registerAiMetadata('POST', '/flaky', aiTool('flaky'));
    registerAiMetadata('POST', '/picky', aiTool('picky'));
    const services = useAi(express(), {
      mcp: { apiKey: 'k' }, logger: new NullLogger(), discoveryProvider: new MetadataDiscoveryProvider(),
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 60_000 },
    });
    let runs = 0;
    services.mcpExecutor.registerHandler('flaky', () => { runs++; throw new Error('upstream down'); });
    services.mcpExecutor.registerHandler('picky', () => { throw new McpToolHttpError('picky', 404, 'not found'); });

    for (let i = 0; i < 2; i++) await services.mcpHandler.handle(call('flaky'));
    expect(services.circuitBreaker!.getState('flaky')).toBe(CircuitState.Open);
    const refused = await services.mcpHandler.handle(call('flaky'));
    expect((refused!.result as any).isError).toBe(true);
    expect((refused!.result as any).content[0].text).toContain('temporarily unavailable');
    expect(runs).toBe(2);

    // Caller errors (HTTP 4xx) never open the circuit.
    for (let i = 0; i < 5; i++) await services.mcpHandler.handle(call('picky'));
    expect(services.circuitBreaker!.getState('picky')).toBe(CircuitState.Closed);
  });
});

// ─── SSE session binding ─────────────────────────────────────────────────────────

describe('SSE sessions are bound to the credentials that opened them', () => {
  it('rejects a message posted to another caller\'s session', async () => {
    const { handler, executor } = makeHandler([tool('noop')]);
    let calls = 0;
    executor.registerHandler('noop', () => { calls++; return 'ok'; });
    const app = express();
    app.use(express.json());
    const sse = createSseTransport(handler, {
      authenticate: (req) => ['Bearer alice', 'Bearer bob'].includes(req.header('authorization') ?? ''),
    });
    app.use(sse);
    const { server, url } = await listen(app);
    const controller = new AbortController();
    try {
      const stream = await fetch(`${url}/mcp/sse`, { headers: { Authorization: 'Bearer alice' }, signal: controller.signal });
      const first = new TextDecoder().decode((await stream.body!.getReader().read()).value);
      const endpoint = /data: (\S+)/.exec(first)![1];

      const asBob = await fetch(`${url}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bob' },
        body: rpc('tools/call', { name: 'noop', arguments: {} }),
      });
      expect(asBob.status).toBe(404);
      expect(calls).toBe(0);

      const asAlice = await fetch(`${url}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer alice' },
        body: rpc('tools/call', { name: 'noop', arguments: {} }),
      });
      expect(asAlice.status).toBe(202);
      expect(calls).toBe(1);
    } finally {
      controller.abort();
      sse.close();
      await close(server);
    }
  });
});

// ─── Rate-limit client key ───────────────────────────────────────────────────────

describe('rate-limit client key', () => {
  it('groups IPv6 addresses by /64 so address rotation does not get fresh buckets', () => {
    expect(rateLimitClientKey('2001:db8:1:2:aaaa::1')).toBe(rateLimitClientKey('2001:0db8:0001:0002:ffff:1:2:3'));
    expect(rateLimitClientKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitClientKey('2001:db8:1:3::1')).not.toBe(rateLimitClientKey('2001:db8:1:2::1'));
  });

  it('keeps IPv4 (also IPv4-mapped) and unknown ids as they are', () => {
    expect(rateLimitClientKey('10.0.0.1')).toBe('10.0.0.1');
    expect(rateLimitClientKey('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(rateLimitClientKey(undefined)).toBe('anonymous');
    expect(rateLimitClientKey('tenant-a')).toBe('tenant-a');
  });

  it('shares one bucket across a rotating IPv6 /64', async () => {
    const { handler, executor } = makeHandler([tool('limited', { rateLimitPerMinute: 1 })]);
    executor.registerHandler('limited', () => 'ok');
    expect((await handler.handle(call('limited'), { clientId: '2001:db8::1' }))!.error).toBeUndefined();
    expect((await handler.handle(call('limited'), { clientId: '2001:db8::2' }))!.error?.code).toBe(-32000);
  });
});

describe('package metadata', () => {
  it('reports the package.json version as the default serverVersion', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });
});
