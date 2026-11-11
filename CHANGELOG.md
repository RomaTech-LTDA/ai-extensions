# Changelog

All notable changes to @romatech/ai-extensions will be documented in this file.

## [Unreleased]

## [3.0.0] - 2026-11-11

Security release. The MCP endpoint is now secure by default, matching the .NET package
`Romatech.Extensions.Ai` 4.0.0. Read **Breaking** before upgrading.

### Breaking
- **Authentication is required.** `useAi()`, `createMcpMiddleware()`, `createFastifyMcpPlugin()`, `createKoaMcpMiddleware()`, `createLambdaMcpHandler()`, `createNextjsMcpHandler()`, `createNextjsAppMcpHandler()`, `createNestMcpController()`, `createSseTransport()` and `createWsMcpHandler()` throw at startup unless `mcp.apiKey`, an `mcp.authenticate(request)` hook or `mcp.allowAnonymous: true` is configured. In 2.x `/mcp` was open to anyone by default. Upgrade: set `apiKey` (clients send `Authorization: Bearer <key>`), or `authenticate`, or opt out explicitly with `allowAnonymous: true`.
- **Roles are enforced and fail closed.** Tools, resources and `rag_search` results that declare a role (`@AiRole`, `aiTool({ role })`, `x-ai-role`) are hidden and refused unless the new `mcp.resolveRoles(context)` returns one of the listed roles. In 2.x the role was recorded but never checked. Upgrade: configure `resolveRoles` (it receives `context.principal`, the value returned by `authenticate`).
- **WebSocket transport** authenticates the upgrade: use `verifyClient` (for `ws`) or `authenticateUpgrade(req)`, then pass `getContext(req)` to `handleMessage(raw, context)`. Messages without the context of an authenticated upgrade are rejected (`-32001`) unless the endpoint is anonymous (`allowAnonymous: true` with neither `apiKey` nor `authenticate`; a configured key or hook is always enforced, as in the HTTP adapters). The Origin header is checked (403).
- **NestJS**: `createNestMcpController().handlePost(body, req, res?)` requires the request (throws `TypeError` without it) and always runs the Origin, authentication and Content-Type checks. Pass `@Res({ passthrough: true })` to get the real HTTP status.
- **Origin and Content-Type checks** in every adapter: a request with an `Origin` not listed in `allowedOrigins` or `cors` gets 403; a body whose media type is not `application/json` gets 415.
- **Tool failures are results, not protocol errors** (MCP spec): a non-2xx response, timeout or exception is returned as `result` with `isError: true` instead of a JSON-RPC `error`. Unknown tools and invalid arguments are still JSON-RPC errors (`-32602`).
- **Notifications** (messages without `id`) get `202 Accepted` with an empty body and never execute anything. `McpRequestHandler.handle()` now returns `McpResponse | null` (`null` for a notification).
- **Rate limits are per client** (`<clientId>|<tool>`); 2.x had one bucket per tool shared by all clients. IPv6 clients are grouped by /64.
- `createSseTransport()` no longer installs `SIGTERM`/`SIGINT` handlers (they disabled Node's default exit); call the new `close()` from your shutdown code. SSE sessions are bound to the `Authorization` header that opened them.
- `useAiSwaggerEnricher()` must be registered **before** the spec route and no longer adds the non-standard `extensions` field to operations.
- `engines.node` is now `>=22` (the versions tested in CI: 22 and 24).

### Security
- Path parameters are validated and percent-encoded per segment; `..`, `/`, `\` and control characters are rejected (`-32602`). Previously `{"id": "../../leads"}` reached routes marked `aiHidden()`, and `?`/`#` injected query strings.
- `aiHidden()`/`aiTool()` registered with Express-style paths (`/leads/:id`) now apply to the OpenAPI path (`/leads/{id}`). Previously such hidden routes stayed exposed under Swagger discovery.
- Origin validation (new `allowedOrigins` option; `cors` origins are also accepted) and strict `application/json` in every adapter (Express, Fastify, Koa, Hono, Lambda, Next.js, NestJS, SSE). Previously Hono, Lambda and the Next.js App Router accepted cross-site `text/plain` requests.
- SSE: the message route requires authentication and passes the Origin/Content-Type checks (in 2.x it skipped the API key); session ids use `crypto.randomUUID()`; a session only accepts messages carrying the credentials that opened it.
- WebSocket: cross-site WebSocket hijacking is blocked by the Origin check, and exceptions from the handler are answered with a generic `Internal error`.
- HTTP tool calls no longer follow redirects (`redirect: 'manual'`); a 3xx is returned as an `isError` result. Previously a redirect could send the call, with the forwarded caller credentials, to a route or host that was never validated.
- Error bodies returned to the client are cut to 2048 characters (`MAX_ERROR_BODY_CHARS`), and tool responses are read up to `maxToolResponseBytes` (default 1 MiB), so a development stack trace or an endless response cannot be relayed whole or exhaust memory.
- `rag_search` queries are limited to 1024 characters.
- `resources/read` and the built-in `rag_search` are rate-limited per client like `tools/call` (they bypassed the limiter).
- API key comparison is constant-time.
- Exception messages are no longer returned to clients (`Internal error` / generic tool error); details go to the logger.

### Added
- `mcp.authenticate(request)`, `mcp.allowAnonymous`, `mcp.resolveRoles(context)`, `mcp.allowedOrigins`, `mcp.maxToolResponseBytes`.
- `McpCallContext` (`clientId`, `principal`, `forwardHeaders`), passed to `handle()`, `McpToolExecutor.execute()` and in-process `ToolHandler`s.
- `processMcpHttpRequest()`, `guardMcpHttpRequest()`, `authenticateMcpRequest()` and `sendExpressOutcome()` to build custom routes with the same checks.
- `useAi()` returns `auditLog` (an in-memory `McpAuditLog`, on by default; `auditLog: false` disables it) and, with the new `circuitBreaker` option (opt-in), `circuitBreaker`. Both are now wired into the handler: in 2.x they were exported and advertised but never used. HTTP 4xx answers do not count as circuit-breaker failures.
- `McpAuditLog({ maxEntries, includeArguments })`: tool arguments are not stored unless `includeArguments: true` (the numeric constructor still works).
- `createWsMcpHandler()` returns `verifyClient`, `authenticateUpgrade` and `getContext`; `createSseTransport()` returns `close()`.
- `rateLimitClientKey()`, `SlidingWindowRateLimiter({ maxKeys, windowMs })` with bounded memory.

### Fixed
- `forwardAuthorization` was declared but never used: tools now run with the caller's `Authorization` and `Cookie` headers when it is enabled (the MCP API key is never forwarded).
- Metadata-based discovery kept only `/api/items/` for `/api/items/:id` (the key was split on every `:`).
- Arguments of GET/DELETE tools that are not path parameters are sent as query parameters (they were dropped).
- CORS with several origins now echoes the matching origin (a comma-separated `Access-Control-Allow-Origin` is invalid) and sets `Vary: Origin`.
- The Express middleware no longer answers requests for other routes that merely share the MCP prefix (e.g. `/mcp-admin`).
- In-process tool handlers no longer leave a pending timer for the full timeout after they finish.

### Changed
- README and guides: secure-by-default setup, roles, WebSocket, rate limiting behind proxies, resources being opt-out, and `McpMultiTenant` described as what it is (a lookup helper that `useAi()` does not wire). The feature list no longer claims "multi-tenant per API key" or an always-on circuit breaker.
- CI: `npm ci`, Node 22 and 24, read-only `permissions`; the publish workflow uses `npm ci`, Node 22 and runs lint and tests before publishing.
- Development: vitest 2 → 4.1.12 (clears the critical/high dev-only advisories in vitest, vite and esbuild).
- The default `serverVersion` comes from `PACKAGE_VERSION`, checked against package.json by a test.
- Standardized `index.html` landing page (GitHub Pages).

## [2.0.0] - 2026-06-26

### Added
- **Multi-framework**: Express, Fastify, Koa, Hono auto-detected by `useAi()`
- **Controller decorators**: `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`
- **AI decorators**: `@AiTool`, `@AiHidden`, `@AiDescription`, `@AiCategory`, `@AiRole`, `@AiRateLimit`, `@AiContextPriority`
- **`useController(app, Controller)`**: registers routes + AI metadata from decorators
- **Swagger discovery**: auto-discovers all endpoints from OpenAPI spec
- **MCP protocol**: initialize, ping, tools/list, tools/call, resources/list, resources/read, completions/complete, prompts/list, prompts/get
- **Built-in `rag_search` tool**: semantic API documentation search
- **Custom tool handlers**: bypass HTTP with `mcpExecutor.registerHandler()`
- **Tool versioning**: `ToolVersionManager` with deprecation support
- **Dry-run mode**: validate without executing (`dryRun: true`)
- **Pagination**: cursor-based in tools/list
- **Input validation**: required fields + type checking
- **SSE transport**: persistent connections + heartbeat keep-alive (30s)
- **WebSocket transport**: `createWsMcpHandler()`
- **API key auth** + **CORS headers**
- **Health endpoint**: `GET /mcp/health`
- **Rate limiting**: sliding window, per-tool, configurable
- **Circuit breaker**: auto-disable failing tools
- **Metrics**: call count, errors, latency tracking
- **Audit log**: full tool execution history
- **Multi-tenant MCP**: different tools per API key
- **Adapters**: Fastify, Koa, Hono, NestJS, Next.js (Pages + App Router), tRPC, AWS Lambda
- **Embedding providers**: Local (zero-deps), OpenAI, Ollama
- **RAG**: index TTL, auto-rebuild, semantic search
- **Swagger enrichment**: `x-ai-*` extensions injected into spec
- **Logger interface**: `ILogger`, `ConsoleLogger`, `NullLogger`
