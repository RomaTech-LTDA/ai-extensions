# Changelog

All notable changes to @romatech/ai-extensions will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Multi-framework support: Express, Fastify, Koa, Hono (auto-detected)
- Controller decorators: `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`
- AI decorators: `@AiTool`, `@AiHidden`, `@AiDescription`, `@AiCategory`, `@AiRole`, `@AiRateLimit`, `@AiContextPriority`
- `useController(app, Controller)` — registers routes + AI metadata from decorators
- `useAi(app)` — works identically on Express, Fastify, Koa Router, Hono
- Swagger-based auto-discovery of all API endpoints
- MCP protocol: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `completions/complete`, `prompts/list`, `prompts/get`
- Built-in `rag_search` MCP tool for semantic API documentation search
- Cursor-based pagination in `tools/list`
- Input argument validation (required fields, type checks)
- API key authentication (`Authorization: Bearer <key>`)
- CORS headers (configurable)
- SSE transport (`GET /mcp/sse` + `POST /mcp/message`)
- Health endpoint (`GET /mcp/health`)
- Tool execution timeout (configurable, default 30s)
- Rate limiting (sliding window, per-tool)
- Metrics tracking (call count, errors, latency)
- MCP Resources (read-only GET endpoints as MCP resources)
- MCP Prompts (built-in `list_available_tools` + `search_api`)
- MCP Completions (tool name + enum value autocomplete)
- Tool list change notifications
- RAG index TTL with auto-rebuild
- Swagger spec enrichment with `x-ai-*` extensions
- Local embedding provider (zero external deps)
- Logger interface (`ILogger` + `ConsoleLogger` + `NullLogger`)
- Fastify adapter (`createFastifyMcpPlugin`)
- Koa adapter (`createKoaMcpMiddleware`)
