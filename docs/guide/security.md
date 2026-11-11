# Security

## Authentication (secure by default)

Since 3.0.0, `useAi()` and every adapter (Express, Fastify, Koa, Hono, Lambda, Next.js, NestJS,
SSE, WebSocket) **throw at startup** unless one of `apiKey`, `authenticate` or
`allowAnonymous: true` is configured.

Protect your MCP endpoint with an API key:

```ts
useAi(app, {
  mcp: {
    apiKey: process.env.MCP_API_KEY,
  },
});
```

Clients must include the key in the `Authorization` header:

```
Authorization: Bearer your-api-key
```

Or authenticate callers with your own logic (session cookie, JWT...). Return the caller to
accept the request; a falsy value or a thrown error answers 401. When both `apiKey` and
`authenticate` are set, both must pass.

```ts
useAi(app, {
  mcp: {
    authenticate: async (req) => verifyJwt(req.header('authorization')), // returns the user or null
  },
});
```

To expose the endpoint without authentication (e.g. on a private network), opt out explicitly:
`mcp: { allowAnonymous: true }`. `useAi()` logs a warning in that case.

## Roles

`@AiRole('admin')` / `aiTool({ role: 'admin' })` is enforced through `resolveRoles`, which receives
the call context (`context.principal` is what `authenticate` returned):

```ts
useAi(app, {
  mcp: {
    authenticate: async (req) => verifyJwt(req.header('authorization')),
    resolveRoles: (context) => (context.principal as any)?.roles ?? [],
  },
});
```

A role list such as `'admin,support'` is satisfied by any listed role. Enforcement **fails
closed**: when a tool declares a role and no resolver is configured, when the resolver throws, or
when the caller lacks the role, the tool (or resource, or `rag_search` result) is hidden and refused.

## WebSocket

```ts
const mcpWs = createWsMcpHandler(handler, { apiKey: process.env.MCP_API_KEY, allowedOrigins: ['https://app.example'] });
const wss = new WebSocketServer({ port: 8080, verifyClient: mcpWs.verifyClient });
wss.on('connection', (ws, req) => {
  const context = mcpWs.getContext(req);
  ws.on('message', async (data) => {
    const response = await mcpWs.handleMessage(data.toString(), context);
    if (response) ws.send(JSON.stringify(response));
  });
});
```

`verifyClient` rejects disallowed origins (403) and unauthenticated upgrades (401).

## Authorization Forwarding

To forward the caller's auth token to tool endpoints:

```ts
useAi(app, {
  mcp: {
    forwardAuthorization: true,
  },
});
```

## CORS

Configure allowed origins:

```ts
useAi(app, {
  mcp: {
    cors: ['https://my-app.com', 'http://localhost:3000'],
    // or cors: '*' for development
  },
});
```

## Input Sanitization

⚠️ **Important:** Arguments received from LLMs via `tools/call` are validated against the input schema (required fields, types), but are NOT deeply sanitized.

If your endpoints perform:
- SQL queries → use parameterized queries (ORM handles this)
- Shell commands → never interpolate arguments into command strings
- File operations → validate paths against an allowlist

The framework validates types and required fields, but application-level validation is your responsibility.

## Rate Limiting

Per-tool rate limiting is enabled by default:

```ts
registerAiMetadata('POST', '/api/orders', aiTool({
  toolName: 'create_order',
  rateLimit: 10, // 10 requests per minute for this tool
}));
```

Global rate limit (default 60/min) applies to tools without specific limits. Limits are per
client address (IPv6 grouped by /64) and per tool: behind a reverse proxy configure your
framework's trusted proxy setting, otherwise every caller shares the proxy's bucket.

## Best Practices

1. Use `apiKey` and/or `authenticate` in production; never `allowAnonymous` on a public network
2. Use `aiHidden()` for sensitive endpoints (delete, admin). GET endpoints without a decorator are
   readable through `resources/read`
3. Set appropriate `rateLimit` per tool
4. Keep MCP behind a reverse proxy with TLS
5. Monitor tool usage via `metrics.getAll()` and the `auditLog` returned by `useAi()`
