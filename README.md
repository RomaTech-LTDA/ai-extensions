# @romatech/ai-extensions

Plug-and-play AI enablement framework for Node.js APIs. Transforms Express/Fastify/Koa endpoints into **MCP tools** and **RAG-enabled knowledge sources** automatically.

The Node.js equivalent of [Romatech.Extensions.Ai](https://github.com/RomaTech-LTDA/dotnet-ai-extensions) for .NET.

## Features

- **MCP Server** — Expose your API endpoints as MCP (Model Context Protocol) tools for LLMs
- **RAG Search** — Semantic search across your API documentation with local embeddings
- **Metadata Decorators** — Annotate routes with `aiTool()`, `aiHidden()`, `aiReadOnly()`
- **Rate Limiting** — Built-in sliding-window rate limiter per tool
- **Zero External Dependencies** — No OpenAI/Ollama required for basic usage

## Installation

```bash
npm install @romatech/ai-extensions
```

## Quick Start

```ts
import express from 'express';
import { useAi, registerAiMetadata, aiTool, aiHidden } from '@romatech/ai-extensions';

const app = express();
app.use(express.json());

// Define your routes
app.get('/api/orders', (req, res) => {
  res.json([{ id: 1, status: 'Pending' }]);
});

app.post('/api/orders', (req, res) => {
  res.json({ id: 2, status: 'Created', ...req.body });
});

app.delete('/api/orders/:id', (req, res) => {
  res.sendStatus(204);
});

// Annotate with AI metadata
registerAiMetadata('POST', '/api/orders', aiTool({
  toolName: 'create_order',
  description: 'Creates a new customer order',
  category: 'Orders',
  rateLimit: 10,
}));

registerAiMetadata('DELETE', '/api/orders/:id', aiHidden());

// Enable AI — that's it!
const { ragSearch } = useAi(app, {
  baseUrl: 'http://localhost:3000',
  mcp: {
    serverName: 'my-api',
    serverVersion: '1.0.0',
  },
});

app.listen(3000);
```

## How It Works

### MCP Protocol

Once enabled, your app responds to MCP JSON-RPC requests at `POST /mcp`:

```bash
# Initialize
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

# List tools
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Call a tool
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_order","arguments":{"productId":"ABC","quantity":2}}}'
```

### RAG Search

```ts
const results = await ragSearch.search('how to create orders');
console.log(results); // ranked by semantic similarity
```

## Architecture

| Module | Description |
|--------|-------------|
| `@romatech/ai-extensions` | Main entry point with `useAi()` setup |
| `@romatech/ai-extensions/mcp` | MCP middleware, protocol, registry, executor |
| `@romatech/ai-extensions/rag` | Semantic indexer, local embeddings, search service |
| `@romatech/ai-extensions/metadata` | Route annotation helpers |

## API

### `useAi(app, options?)`

Registers MCP middleware and initializes RAG services.

### `registerAiMetadata(method, path, metadata)`

Associates AI metadata with a route.

### `aiTool(nameOrOptions?)`

Marks a route as an executable MCP tool.

### `aiHidden()`

Marks a route as hidden from AI systems.

### `aiReadOnly(options?)`

Marks a route as read-only (RAG-visible but not executable).

## License

MIT
