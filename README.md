# @romatech/ai-extensions

[![npm](https://img.shields.io/npm/v/@romatech/ai-extensions)](https://www.npmjs.com/package/@romatech/ai-extensions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/RomaTech-LTDA/ai-extensions-node/blob/main/LICENSE)

Plug-and-play AI enablement framework for Node.js APIs. Transforms your endpoints into **MCP tools** and **RAG-enabled knowledge sources** — identical to the .NET version.

Works with **Express**, **Fastify**, **Koa**, and **Hono**.

## Features

- **Decorator-based** — `@AiTool`, `@AiHidden`, `@AiDescription` (like .NET attributes)
- **Multi-framework** — Express, Fastify, Koa, Hono (auto-detected)
- **MCP Server** — Full Model Context Protocol implementation
- **RAG Search** — Semantic search across API documentation
- **Swagger Discovery** — Auto-discovers endpoints from OpenAPI spec
- **Zero Config** — Just `useController()` + `useAi()` and it works
- **Auth & CORS** — Built-in API key auth and CORS headers
- **Metrics** — Tool usage tracking (calls, errors, latency)
- **SSE Transport** — Server-Sent Events for persistent connections

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
useAi(app, { baseUrl: 'http://localhost:3000' });

app.listen(3000);
```

That's it. Your API is now MCP-enabled with RAG search.

## Works With Any Framework

```typescript
// Express
useController(app, OrdersController);
useAi(app);

// Fastify
useController(fastify, OrdersController);
useAi(fastify);

// Koa (via @koa/router)
useController(router, OrdersController);
useAi(router);

// Hono
useController(app, OrdersController);
useAi(app);
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
| `@AiRole('...')` | `[AiRole("...")]` | Required role |
| `@AiRateLimit(n)` | `[AiRateLimit(n)]` | Max requests/minute |
| `@AiContextPriority(n)` | `[AiContextPriority(n)]` | RAG ranking priority |

## MCP Protocol

Once enabled, your app responds at `POST /mcp`:

```bash
# List tools
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_order","arguments":{"product":"Widget"}}}'

# Search API docs (RAG)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rag_search","arguments":{"query":"how to create orders"}}}'
```

## Exposure Rules

| State | MCP Tool | RAG Search | Resources |
|-------|----------|------------|-----------|
| `@AiTool()` | ✅ Executable | ✅ Indexed | ❌ |
| `@AiHidden()` | ❌ | ❌ | ❌ |
| No decorator | ❌ | ✅ Indexed | ✅ (GET only) |

## Configuration

```typescript
useAi(app, {
    baseUrl: 'http://localhost:3000',
    mcp: {
        route: '/mcp',
        serverName: 'my-api',
        serverVersion: '1.0.0',
        apiKey: process.env.MCP_API_KEY,      // auth
        cors: '*',                             // CORS
        enableRateLimiting: true,
        globalRateLimitPerMinute: 60,
        toolTimeoutMs: 30000,
    },
    rag: {
        maxSearchResults: 10,
        minimumSimilarity: 0.3,
        indexTtlMs: 300000,                    // 5min cache
    },
});
```

## .NET Equivalent

This package is the Node.js equivalent of [Romatech.Extensions.Ai](https://github.com/RomaTech-LTDA/dotnet-ai-extensions). Both produce identical MCP responses from the client perspective.

## License

MIT
