# @romatech/ai-extensions

[![npm](https://img.shields.io/npm/v/@romatech/ai-extensions)](https://www.npmjs.com/package/@romatech/ai-extensions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/RomaTech-LTDA/ai-extensions/blob/main/LICENSE)

Plug-and-play AI enablement framework for Node.js APIs. Transforms your endpoints into **MCP tools** and **RAG-enabled knowledge sources** — identical to the .NET version.

Works with **Express**, **Fastify**, **Koa**, and **Hono**.

## Features

- **Decorator-based** — `@AiTool`, `@AiHidden`, `@AiDescription` (like .NET attributes)
- **Multi-framework** — Express, Fastify, Koa, Hono, NestJS, Next.js, tRPC, AWS Lambda
- **MCP Server** — Full Model Context Protocol implementation
- **RAG Search** — Semantic search across API documentation
- **Swagger Discovery** — Auto-discovers endpoints from OpenAPI spec
- **Custom Handlers** — Bypass HTTP with in-process tool handlers
- **Tool Versioning** — v1/v2 with deprecation support
- **Dry-run Mode** — Validate without executing
- **Secure by default** — the MCP endpoint requires an API key or your own `authenticate` hook (explicit `allowAnonymous: true` opt-out), Origin validation (MCP spec), CORS, caller credential forwarding
- **Roles** — `@AiRole` / `aiTool({ role })` enforced through your `resolveRoles` (fails closed)
- **Circuit Breaker** — opt-in (`circuitBreaker: true`): refuses tools that keep failing (timeouts, 5xx)
- **Metrics + Audit** — tool usage metrics and an in-memory audit log of executions (`useAi()` returns `auditLog`)
- **SSE + WebSocket** — Persistent transports with heartbeat; WebSocket upgrades are authenticated (`verifyClient`)
- **Embedding Providers** — Local (zero deps), OpenAI, Ollama

## Installation

```bash
npm install @romatech/ai-extensions reflect-metadata
```

Add to `tsconfig.json`:
```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Quick Start

```typescript
import 'reflect-metadata';
import express from 'express';
import { Controller, Get, Post, Delete, AiTool, AiHidden, AiDescription, AiCategory, useController, useAi } from '@romatech/ai-extensions';

@Controller('/api/orders')
class OrdersController {
    @Get('/')
    @AiDescription('Lists all orders')
    @AiCategory('Orders')
    static getAll(req, res) {
        res.json([{ id: 1, status: 'Pending' }]);
    }

    @Post('/')
    @AiTool('create_order')
    @AiDescription('Creates a new customer order')
    @AiCategory('Orders')
    static create(req, res) {
        res.status(201).json({ id: 2, ...req.body });
    }

    @Delete('/:id')
    @AiHidden()
    static delete(req, res) {
        res.sendStatus(204);
    }
}

const app = express();
app.use(express.json());

useController(app, OrdersController);
useAi(app, {
    baseUrl: 'http://localhost:3000',
    mcp: { apiKey: process.env.MCP_API_KEY },   // required: apiKey, authenticate or allowAnonymous
});

app.listen(3000);
```

That's it. Your API is now MCP-enabled with RAG search. MCP clients call it with
`Authorization: Bearer <MCP_API_KEY>`.

> **Since 3.0.0 the MCP endpoint is secure by default.** `useAi()` and every adapter throw at
> startup unless `mcp.apiKey`, an `mcp.authenticate(request)` hook or `mcp.allowAnonymous: true`
> is configured. See [Security](#security) and the [CHANGELOG](CHANGELOG.md) for the upgrade notes.

## Works With Any Framework

```typescript
const mcp = { apiKey: process.env.MCP_API_KEY };

// Express
useController(app, OrdersController);
useAi(app, { mcp });

// Fastify
useController(fastify, OrdersController);
useAi(fastify, { mcp });

// Koa (via @koa/router)
useController(router, OrdersController);
useAi(router, { mcp });

// Hono
useController(app, OrdersController);
useAi(app, { mcp });
```

`useAi()` auto-detects the framework and registers the MCP endpoint accordingly.

## Decorators

| Decorator | Equivalent .NET | Effect |
|-----------|----------------|--------|
| `@Controller('/path')` | `[Route("/path")]` | Base path for all methods |
| `@Get('/')` | `[HttpGet]` | Registers GET route |
| `@Post('/')` | `[HttpPost]` | Registers POST route |
| `@Put('/')` | `[HttpPut]` | Registers PUT route |
| `@Delete('/')` | `[HttpDelete]` | Registers DELETE route |
| `@AiTool('name')` | `[AiTool("name")]` | Marks as executable MCP tool |
| `@AiHidden()` | `[AiHidden]` | Hides from AI completely |
| `@AiDescription('...')` | `[AiDescription("...")]` | AI-facing description |
| `@AiCategory('...')` | `[AiCategory("...")]` | Semantic grouping |
| `@AiRole('...')` | `[AiRole("...")]` | Required role (any of a comma-separated list), enforced via `mcp.resolveRoles`; hidden and refused when no resolver is configured |
| `@AiRateLimit(n)` | `[AiRateLimit(n)]` | Max requests/minute |
| `@AiContextPriority(n)` | `[AiContextPriority(n)]` | RAG ranking priority |

## MCP Protocol

Once enabled, your app responds at `POST /mcp`:

```bash
# List tools
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_order","arguments":{"product":"Widget"}}}'

# Search API docs (RAG)
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rag_search","arguments":{"query":"how to create orders"}}}'
```

Notifications (JSON-RPC messages without `id`) are answered with `202 Accepted` and an empty body.
The server reports protocol version `2024-11-05` over plain HTTP POST (no Streamable HTTP sessions).

## Exposure Rules

| State | MCP Tool | RAG Search | Resources |
|-------|----------|------------|-----------|
| `@AiTool()` | ✅ Executable | ✅ Indexed | ❌ |
| `@AiHidden()` | ❌ | ❌ | ❌ |
| No decorator | ❌ | ✅ Indexed | ✅ (GET only) |

> **Resources are opt-out.** Every GET endpoint without a decorator is listed by `resources/list`
> and readable through `resources/read`, which performs the GET request (with the caller's
> credentials when `forwardAuthorization` is on). A new GET route is therefore readable by AI
> clients unless you mark it `@AiHidden()` or give it a role.

## Configuration

```typescript
useAi(app, {
    baseUrl: 'http://localhost:3000',
    mcp: {
        route: '/mcp',
        serverName: 'my-api',
        serverVersion: '1.0.0',
        apiKey: process.env.MCP_API_KEY,      // Bearer key for MCP clients
        authenticate: async (req) => verifySession(req.header('cookie')), // optional: your own auth (truthy = caller)
        resolveRoles: (ctx) => ctx.principal?.roles ?? [],               // enforces @AiRole / aiTool({ role })
        // allowAnonymous: true,               // explicit opt-out: no authentication at all
        forwardAuthorization: true,            // run tools with the caller's Authorization/Cookie
        allowedOrigins: ['https://admin.example.com'], // browser origins allowed to call /mcp
        cors: ['https://admin.example.com'],   // CORS headers (single origin echoed back)
        enableRateLimiting: true,
        globalRateLimitPerMinute: 60,          // per client (IP, IPv6 grouped by /64) and per tool
        toolTimeoutMs: 30000,
        maxToolResponseBytes: 1048576,         // longer tool responses are cut and marked truncated
    },
    circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30000 }, // opt-in
    auditLog: { maxEntries: 10000, includeArguments: false },        // default; `false` disables
    rag: {
        maxSearchResults: 10,
        minimumSimilarity: 0.3,
        indexTtlMs: 300000,                    // 5min cache
    },
});
```

## Security

- **Authentication (secure by default)**: every transport and adapter (`useAi`, Express, Fastify, Koa, Hono, Lambda, Next.js, NestJS, SSE, WebSocket) throws at startup unless one of these is set:
  - `apiKey`: clients send `Authorization: Bearer <apiKey>` (constant-time comparison);
  - `authenticate(request)`: your own check (session cookie, JWT...). Return the caller (truthy) to accept; a falsy value or a thrown error answers 401. Its result is available as `context.principal`;
  - `allowAnonymous: true`: explicit opt-out, logged as a warning by `useAi()`.

  When both `apiKey` and `authenticate` are set, both must pass. tRPC has no transport of its own: expose `createTRPCMcpProcedure()` only through an authenticated procedure.
- **Roles**: `@AiRole('admin')` / `aiTool({ role: 'admin' })` (or `x-ai-role` in the OpenAPI spec) is enforced through `mcp.resolveRoles(context)`, which returns the caller's roles. It **fails closed**: when a tool declares a role and no resolver is configured, the resolver throws, or the caller lacks the role, the tool is hidden from `tools/list`, completions and prompts, refused by `tools/call` (as an unknown tool), and the same applies to resources and `rag_search` results.
- **WebSocket**: pass `verifyClient` from `createWsMcpHandler()` to `new WebSocketServer({ verifyClient })` (or call `authenticateUpgrade(req)` yourself). It checks the Origin (403, against cross-site WebSocket hijacking) and the API key / `authenticate` hook (401); `handleMessage()` rejects messages without the context of an authenticated upgrade.
- **SSE**: both routes authenticate; a session is bound to the `Authorization` header that opened it, so another caller who learns the session id gets 404.
- **NestJS**: `handlePost(body, req, res?)` requires the request and always runs the Origin, authentication and Content-Type checks (NestJS also parses urlencoded forms).
- **Caller identity**: tools are executed as HTTP requests to `baseUrl`. With `forwardAuthorization: true`, the caller's `Authorization` and `Cookie` headers are forwarded, so your API applies the caller's own permissions. The MCP API key itself is never forwarded. In-process handlers (`registerHandler`) receive the caller context as their second argument and must authorize on their own.
- **Origin validation**: as required by the MCP specification, requests carrying an `Origin` header are rejected (403) unless the origin is listed in `allowedOrigins` or `cors`. Requests without `Origin` (non-browser MCP clients) are accepted.
- **Content-Type**: only `application/json` bodies are accepted (415 otherwise), which blocks cross-site "simple" `text/plain` requests.
- **Path parameters** are validated and percent-encoded per segment: values such as `../../admin`, `a/b` or `1?x=y` cannot reach another route. Remaining arguments of GET/DELETE tools are sent as query parameters.
- **Tool errors**: a non-2xx response or a failure is returned as a result with `isError: true` (MCP spec). The API's error body is returned cut to 2048 characters; internal exception messages are logged, never returned to the client. Tool responses are read up to `maxToolResponseBytes` (1 MiB) and redirects are never followed.
- **Rate limiting** is per client and per tool, with bounded memory. The client is the address your framework reports: behind a reverse proxy set Express `app.set('trust proxy', ...)` (or the equivalent), otherwise every caller shares the proxy's bucket. IPv6 addresses are grouped by /64. Hono and the Next.js App Router expose no client address, so all callers share one bucket there.
- **Tool execution target**: HTTP tools call `baseUrl` (default `http://localhost:3000`), never the incoming `Host` header, so a caller cannot redirect tool calls (SSRF). Multi-tenant APIs that route by host must register in-process handlers or one `useAi()` per host.
- **Audit log**: `useAi()` returns `auditLog`, an in-memory, bounded log of executed tool calls and resource reads (arguments are not stored unless `includeArguments: true`). It is lost on restart: export it if you need durable records.
- **Multi-tenant**: `McpMultiTenant` is only a lookup table from a tenant key to a handler; it is not wired by `useAi()`. Authenticate the tenant yourself and route to the handler in your own endpoint.

## .NET Equivalent

This package is the Node.js equivalent of [Romatech.Extensions.Ai](https://github.com/RomaTech-LTDA/dotnet-ai-extensions). Both produce identical MCP responses from the client perspective.

## License

MIT
