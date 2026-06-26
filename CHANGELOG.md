# Changelog

All notable changes to @romatech/ai-extensions will be documented in this file.

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
