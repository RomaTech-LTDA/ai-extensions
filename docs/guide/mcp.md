# MCP Protocol

The framework exposes a standard [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `POST /mcp`.

## Supported Methods

### `initialize`

Returns server capabilities and info.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize"
}
```

### `tools/list`

Lists all registered MCP tools (endpoints marked with `aiTool()`).

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

### `tools/call`

Executes a registered tool.

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "create_order",
    "arguments": { "product": "Widget", "quantity": 2 }
  }
}
```

## Built-in Tools

### `rag_search`

When RAG is enabled, a `rag_search` tool is automatically registered. It performs semantic search across your API documentation.

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "rag_search",
    "arguments": { "query": "how to create orders" }
  }
}
```

## SSE Transport

For persistent connections, use the SSE transport:

```ts
import { createSseTransport } from '@romatech/ai-extensions/mcp';

app.use(createSseTransport(handler, { route: '/mcp' }));
```

- `GET /mcp/sse` — Opens SSE connection
- `POST /mcp/message?sessionId=xxx` — Sends messages over the connection
