import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  useAi,
  registerAiMetadata,
  aiTool,
  aiHidden,
  aiReadOnly,
  MetadataDiscoveryProvider,
  SwaggerDiscoveryProvider,
  SlidingWindowRateLimiter,
  McpRequestHandler,
  McpToolRegistry,
  McpToolExecutor,
  createLambdaMcpHandler,
  createNextjsAppMcpHandler,
  createSseTransport,
  NullLogger,
  AiExposureLevel,
  useAiSwaggerEnricher,
} from '../src';
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

function rpc(method: string, params?: Record<string, unknown>, id: number = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

async function callMcp(url: string, body: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, headers: res.headers, json, text };
}

function staticRegistry(endpoints: any[]): McpToolRegistry {
  return new McpToolRegistry({ discoverEndpoints: async () => endpoints });
}

// ─── Shared app: an authenticated API + MCP on the same Express instance ─────────

describe('security: tool execution over HTTP', () => {
  let server: Server;
  let url: string;
  const hits = { leads: 0 };
  let lastItemRequest: { id?: string; query?: Record<string, unknown> } = {};
  let lastSearchQuery: Record<string, unknown> = {};

  beforeAll(async () => {
    metadataRegistry.clear();
    const app = express();
    app.use(express.json());

    const requireSession: express.RequestHandler = (req, res, next) => {
      const cookie = req.headers.cookie ?? '';
      const auth = req.headers.authorization ?? '';
      if (cookie.includes('sid=good') || auth === 'Bearer user-token') return next();
      res.status(401).json({ error: 'unauthorized' });
    };

    app.get('/api/me', requireSession, (_req, res) => res.json({ user: 'alice' }));
    app.get('/api/items/:id', (req, res) => {
      lastItemRequest = { id: req.params.id as string, query: { ...req.query } };
      res.json({ id: req.params.id });
    });
    app.get('/api/leads', (_req, res) => {
      hits.leads++;
      res.json([{ lead: 'secret@example.com' }]);
    });
    app.get('/api/search', (req, res) => {
      lastSearchQuery = { ...req.query };
      res.json({ ok: true });
    });

    registerAiMetadata('GET', '/api/me', aiTool('whoami'));
    registerAiMetadata('GET', '/api/items/:id', aiTool('get_item'));
    registerAiMetadata('GET', '/api/leads', aiHidden());
    registerAiMetadata('GET', '/api/search', aiTool('search'));

    // Bind first so that baseUrl points at the real port.
    const bound = await listen(app);
    server = bound.server;
    url = bound.url;

    const services = useAi(app, {
      baseUrl: url,
      discoveryProvider: new MetadataDiscoveryProvider(),
      logger: new NullLogger(),
      // Anonymous on purpose: this suite checks how the caller's own credentials are forwarded.
      mcp: { forwardAuthorization: true, allowAnonymous: true },
    });
    services.mcpExecutor.registerHandler('leaky', () => {
      throw new Error('connect ECONNREFUSED db.internal:5432 password=hunter2');
    });
    registerAiMetadata('POST', '/internal/leaky', aiTool('leaky'));
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('forwards the caller session cookie to the tool request (forwardAuthorization)', async () => {
    const { json } = await callMcp(url, rpc('tools/call', { name: 'whoami', arguments: {} }), { Cookie: 'sid=good' });
    expect(json.error).toBeUndefined();
    expect(json.result.isError).toBeFalsy();
    expect(JSON.parse(json.result.content[0].text)).toEqual({ user: 'alice' });
  });

  it('forwards the caller bearer token to the tool request (forwardAuthorization)', async () => {
    const { json } = await callMcp(url, rpc('tools/call', { name: 'whoami', arguments: {} }), { Authorization: 'Bearer user-token' });
    expect(json.result.isError).toBeFalsy();
    expect(JSON.parse(json.result.content[0].text)).toEqual({ user: 'alice' });
  });

  it('reports a non-2xx tool response as isError instead of success', async () => {
    const { json } = await callMcp(url, rpc('tools/call', { name: 'whoami', arguments: {} }));
    expect(json.error).toBeUndefined();
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toContain('401');
  });

  it('rejects path traversal in a path parameter and never reaches a hidden route', async () => {
    const before = hits.leads;
    const { json } = await callMcp(url, rpc('tools/call', { name: 'get_item', arguments: { id: '../../api/leads' } }));
    expect(hits.leads).toBe(before);
    expect(json.error?.code).toBe(-32602);
    expect(JSON.stringify(json)).not.toContain('secret@example.com');
  });

  it('rejects encoded and backslash traversal variants', async () => {
    for (const id of ['..', '.', '..\\..\\api\\leads', 'a/b']) {
      const { json } = await callMcp(url, rpc('tools/call', { name: 'get_item', arguments: { id } }));
      expect(json.error?.code, `id=${id}`).toBe(-32602);
    }
    expect(hits.leads).toBe(0);
  });

  it('encodes path parameters so they cannot inject a query string', async () => {
    const { json } = await callMcp(url, rpc('tools/call', { name: 'get_item', arguments: { id: '1?admin=true#x' } }));
    expect(json.result.isError).toBeFalsy();
    expect(lastItemRequest.id).toBe('1?admin=true#x');
    expect(lastItemRequest.query).toEqual({});
  });

  it('sends non-path arguments of a GET tool as query parameters', async () => {
    const { json } = await callMcp(url, rpc('tools/call', { name: 'search', arguments: { q: 'blue widgets', page: 2 } }));
    expect(json.result.isError).toBeFalsy();
    expect(lastSearchQuery).toEqual({ q: 'blue widgets', page: '2' });
  });

  it('does not leak internal error details from a failing tool', async () => {
    const { json, text } = await callMcp(url, rpc('tools/call', { name: 'leaky', arguments: {} }));
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('db.internal');
    expect(json.result.isError).toBe(true);
  });

  it('rejects cross-site requests by Origin (MCP spec: servers MUST validate Origin)', async () => {
    const { status } = await callMcp(url, rpc('tools/list'), { Origin: 'https://evil.example' });
    expect(status).toBe(403);
  });

  it('accepts requests without an Origin header (non-browser MCP clients)', async () => {
    const { status } = await callMcp(url, rpc('tools/list'));
    expect(status).toBe(200);
  });
});

describe('security: Express middleware options', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    metadataRegistry.clear();
    const app = express();
    // A permissive body parser: parses every content type as JSON.
    app.use(express.json({ type: () => true }));
    const bound = await listen(app);
    server = bound.server;
    url = bound.url;
    useAi(app, {
      baseUrl: url,
      discoveryProvider: new MetadataDiscoveryProvider(),
      logger: new NullLogger(),
      mcp: {
        allowAnonymous: true,
        cors: ['https://a.example', 'https://b.example'],
        allowedOrigins: ['https://backoffice.example'],
      },
    });
    // Registered after useAi(): the MCP middleware runs first for this path.
    app.options('/mcp-admin', (_req, res) => { res.status(299).end(); });
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('rejects a CSRF-style text/plain body even when it mentions application/json', async () => {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; x=application/json' },
      body: rpc('tools/list'),
    });
    expect(res.status).toBe(415);
  });

  it('echoes a single allowed origin in Access-Control-Allow-Origin', async () => {
    const { status, headers } = await callMcp(url, rpc('tools/list'), { Origin: 'https://b.example' });
    expect(status).toBe(200);
    expect(headers.get('access-control-allow-origin')).toBe('https://b.example');
    expect(headers.get('vary')?.toLowerCase()).toContain('origin');
  });

  it('accepts an origin listed in allowedOrigins', async () => {
    const { status } = await callMcp(url, rpc('tools/list'), { Origin: 'https://backoffice.example' });
    expect(status).toBe(200);
  });

  it('rejects a preflight from an origin that is not allowed', async () => {
    const res = await fetch(`${url}/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not swallow routes that merely share the MCP prefix', async () => {
    const res = await fetch(`${url}/mcp-admin`, { method: 'OPTIONS' });
    expect(res.status).toBe(299);
  });
});

describe('security: serverless adapters', () => {
  const endpoints = [{
    toolName: 'noop', httpMethod: 'POST', route: '/noop', contextPriority: 0,
    exposureLevel: AiExposureLevel.Executable,
  }];

  function makeHandler() {
    const executor = new McpToolExecutor('http://127.0.0.1:1');
    executor.registerHandler('noop', () => ({ ok: true }));
    return new McpRequestHandler(staticRegistry(endpoints), executor, new SlidingWindowRateLimiter());
  }

  it('Lambda: rejects text/plain bodies (simple-request CSRF)', async () => {
    const lambda = createLambdaMcpHandler(makeHandler(), { allowAnonymous: true });
    const res = await lambda({
      headers: { 'content-type': 'text/plain' },
      body: rpc('tools/call', { name: 'noop', arguments: {} }),
      requestContext: { http: { method: 'POST', path: '/mcp' } },
    } as any);
    expect(res.statusCode).toBe(415);
  });

  it('Lambda: rejects a disallowed Origin', async () => {
    const lambda = createLambdaMcpHandler(makeHandler(), { allowAnonymous: true });
    const res = await lambda({
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: rpc('tools/list'),
      requestContext: { http: { method: 'POST', path: '/mcp' } },
    } as any);
    expect(res.statusCode).toBe(403);
  });

  it('Next.js App Router: rejects text/plain bodies (simple-request CSRF)', async () => {
    const { POST } = createNextjsAppMcpHandler(makeHandler(), { allowAnonymous: true });
    const res = await POST(new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: rpc('tools/call', { name: 'noop', arguments: {} }),
    }));
    expect(res.status).toBe(415);
  });

  it('Next.js App Router: does not leak exception messages', async () => {
    const handler = makeHandler();
    vi.spyOn(handler, 'handle').mockRejectedValue(new Error('SELECT * FROM users -- secret'));
    const { POST } = createNextjsAppMcpHandler(handler, { allowAnonymous: true });
    const res = await POST(new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rpc('tools/list'),
    }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
  });
});

describe('security: rate limiting', () => {
  const endpoints = [{
    toolName: 'limited', httpMethod: 'POST', route: '/limited', contextPriority: 0,
    exposureLevel: AiExposureLevel.Executable, rateLimitPerMinute: 1,
  }];

  it('keeps a separate bucket per client, so one client cannot exhaust another', async () => {
    const executor = new McpToolExecutor('http://127.0.0.1:1');
    executor.registerHandler('limited', () => 'ok');
    const handler = new McpRequestHandler(staticRegistry(endpoints), executor, new SlidingWindowRateLimiter());
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'limited', arguments: {} } };

    expect((await handler.handle(call, { clientId: 'client-a' })).error).toBeUndefined();
    expect((await handler.handle(call, { clientId: 'client-a' })).error?.code).toBe(-32000);
    expect((await handler.handle(call, { clientId: 'client-b' })).error).toBeUndefined();
  });

  it('bounds memory when many distinct clients are seen', () => {
    const limiter = new SlidingWindowRateLimiter({ maxKeys: 100 });
    for (let i = 0; i < 5_000; i++) limiter.tryAcquire(`client-${i}|tool`, 10);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });
});

describe('security: hidden routes declared with Express-style params', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    metadataRegistry.clear();
    const app = express();
    app.get('/api-docs.json', (_req, res) => res.json({
      openapi: '3.0.0',
      paths: {
        '/api/leads/{id}': { get: { operationId: 'getLead', summary: 'Get a lead' } },
        '/api/orders/{id}': { delete: { operationId: 'deleteOrder' } },
      },
    }));
    registerAiMetadata('GET', '/api/leads/:id', aiHidden());
    registerAiMetadata('DELETE', '/api/orders/:id', aiTool('delete_order'));
    registerAiMetadata('GET', '/api/reports/:year/summary', aiReadOnly());
    const bound = await listen(app);
    server = bound.server;
    url = bound.url;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('applies aiHidden()/aiTool() registered as /:id to the OpenAPI /{id} path', async () => {
    const provider = new SwaggerDiscoveryProvider(`${url}/api-docs.json`);
    const endpoints = await provider.discoverEndpoints();
    expect(endpoints.find((e) => e.route === '/api/leads/{id}')).toBeUndefined();
    expect(endpoints.find((e) => e.route === '/api/orders/{id}')?.exposureLevel).toBe(AiExposureLevel.Executable);
  });

  it('keeps the full route (including params) in metadata-based discovery', async () => {
    const endpoints = await new MetadataDiscoveryProvider().discoverEndpoints();
    expect(endpoints.map((e) => e.route).sort()).toEqual([
      '/api/leads/{id}',
      '/api/orders/{id}',
      '/api/reports/{year}/summary',
    ]);
  });
});

describe('security: SSE transport', () => {
  it('requires the API key on the message route, not only when opening the stream', async () => {
    const endpoints = [{
      toolName: 'noop', httpMethod: 'POST', route: '/noop', contextPriority: 0,
      exposureLevel: AiExposureLevel.Executable,
    }];
    const executor = new McpToolExecutor('http://127.0.0.1:1');
    let calls = 0;
    executor.registerHandler('noop', () => { calls++; return 'ok'; });
    const handler = new McpRequestHandler(staticRegistry(endpoints), executor, new SlidingWindowRateLimiter());

    const app = express();
    app.use(express.json());
    const sse = createSseTransport(handler, { apiKey: 'k1' });
    app.use(sse);
    const { server, url } = await listen(app);
    const controller = new AbortController();
    try {
      const stream = await fetch(`${url}/mcp/sse`, { headers: { Authorization: 'Bearer k1' }, signal: controller.signal });
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      const endpoint = /data: (\S+)/.exec(first)![1];
      expect(endpoint).toMatch(/sessionId=[0-9a-f-]{36}$/);

      const res = await fetch(`${url}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rpc('tools/call', { name: 'noop', arguments: {} }),
      });
      expect(res.status).toBe(401);
      expect(calls).toBe(0);
    } finally {
      controller.abort();
      sse.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('swagger enricher', () => {
  it('marks hidden Express-style routes in the served spec without adding non-standard fields', async () => {
    metadataRegistry.clear();
    registerAiMetadata('GET', '/api/leads/:id', aiHidden());
    const app = express();
    useAiSwaggerEnricher(app);
    app.get('/api-docs.json', (_req, res) => res.json({
      openapi: '3.0.0',
      paths: { '/api/leads/{id}': { get: { operationId: 'getLead' } } },
    }));
    const { server, url } = await listen(app);
    try {
      const spec = await (await fetch(`${url}/api-docs.json`)).json();
      const op = spec.paths['/api/leads/{id}'].get;
      expect(op['x-ai-hidden']).toBe(true);
      expect(op).not.toHaveProperty('extensions');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('robustness', () => {
  it('SSE transport does not hijack SIGTERM/SIGINT', () => {
    const before = [process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')];
    const handler = new McpRequestHandler(staticRegistry([]), new McpToolExecutor('http://127.0.0.1:1'), new SlidingWindowRateLimiter());
    createSseTransport(handler, { apiKey: 'k' });
    expect([process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')]).toEqual(before);
  });

  it('clears the in-process handler timeout once the handler settles', async () => {
    vi.useFakeTimers();
    try {
      const executor = new McpToolExecutor('http://127.0.0.1:1', 30_000);
      executor.registerHandler('fast', () => 'done');
      await executor.execute({
        toolName: 'fast', httpMethod: 'POST', route: '/fast', contextPriority: 0,
        exposureLevel: AiExposureLevel.Executable,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('security: review follow-ups', () => {
  let server: Server;
  let url: string;
  let leadsHits = 0;
  let publicHits = 0;

  beforeAll(async () => {
    const api = express();
    api.get('/api/leads', (_req, res) => { leadsHits++; res.json([{ lead: 'secret@example.com' }]); });
    api.get('/api/redirect/:id', (_req, res) => res.redirect('/api/leads'));
    api.get('/api/public', (_req, res) => { publicHits++; res.json({ ok: true }); });
    ({ server, url } = await listen(api));
  });

  afterAll(() => server?.close());

  it('does not follow redirects, so a tool cannot be bounced to a route it was not built for', async () => {
    const executor = new McpToolExecutor(url, 2_000);
    const descriptor = {
      toolName: 'bounce', httpMethod: 'GET', route: '/api/redirect/{id}', contextPriority: 0,
      exposureLevel: AiExposureLevel.Executable,
    };
    const handler = new McpRequestHandler(staticRegistry([descriptor]), executor, new SlidingWindowRateLimiter());
    const response = await handler.handle(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bounce', arguments: { id: 'x' } } },
      { clientId: 'c', forwardHeaders: { cookie: 'sid=victim' } },
    );

    expect((response.result as any).isError).toBe(true);
    expect((response.result as any).content[0].text).toContain('302');
    expect(leadsHits).toBe(0);
  });

  it('rate-limits resources/read and rag_search per client, like tools/call', async () => {
    const endpoints = [{
      toolName: 'get_public', httpMethod: 'GET', route: '/api/public', contextPriority: 0,
      exposureLevel: AiExposureLevel.ReadOnly, rateLimitPerMinute: 1,
    }];
    const provider = { discoverEndpoints: async () => endpoints };
    const handler = new McpRequestHandler(
      new McpToolRegistry(provider), new McpToolExecutor(url, 2_000), new SlidingWindowRateLimiter(),
      { globalRateLimitPerMinute: 1 },
    );
    const { McpResourceRegistry } = await import('../src/mcp/resources');
    handler.attachResources(new McpResourceRegistry(provider));
    handler.attachRagSearch({ search: async () => [] } as any);

    const read = { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'api:///api/public' } };
    expect((await handler.handle(read, { clientId: 'a' })).error).toBeUndefined();
    expect((await handler.handle(read, { clientId: 'a' })).error?.code).toBe(-32000);
    expect((await handler.handle(read, { clientId: 'b' })).error).toBeUndefined();
    expect(publicHits).toBe(2);

    const rag = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'rag_search', arguments: { query: 'x' } } };
    expect((await handler.handle(rag, { clientId: 'a' })).error).toBeUndefined();
    expect((await handler.handle(rag, { clientId: 'a' })).error?.code).toBe(-32000);
  });
});
