# Examples

## Connecting LLMs to your MCP server

### Claude Desktop

Add to your Claude Desktop config (`~/.claude/mcp.json` or via Settings → MCP):

```json
{
  "mcpServers": {
    "my-api": {
      "url": "http://localhost:3000/mcp",
      "transport": "http"
    }
  }
}
```

### Kiro

Add to `.kiro/settings/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "my-api": {
      "url": "http://localhost:3000/mcp",
      "transport": "http"
    }
  }
}
```

### SSE Transport

For persistent connections (lower latency):

```json
{
  "mcpServers": {
    "my-api": {
      "url": "http://localhost:3000/mcp/sse",
      "transport": "sse"
    }
  }
}
```

## Quick Test

Start the test app:

```bash
cd romatech-orm-test-app
npm run dev
```

Then test with curl:

```bash
# Initialize
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | jq

# List tools
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq

# Search with RAG
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rag_search","arguments":{"query":"create product"}}}' | jq

# Execute a tool
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_product","arguments":{"name":"Widget","price":9.99}}}' | jq
```
