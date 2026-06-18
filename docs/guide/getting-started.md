# Getting Started

## Installation

```bash
npm install @romatech/ai-extensions
```

## Basic Setup

```ts
import express from 'express';
import { useAi, registerAiMetadata, aiTool } from '@romatech/ai-extensions';

const app = express();
app.use(express.json());

// Define your routes
app.post('/api/orders', (req, res) => {
  res.json({ id: 1, ...req.body });
});

// Annotate with AI metadata
registerAiMetadata('POST', '/api/orders', aiTool({
  toolName: 'create_order',
  description: 'Creates a new order',
}));

// Enable AI
useAi(app, { baseUrl: 'http://localhost:3000' });

app.listen(3000);
```

## Verify Installation

Send a POST to `/mcp`:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You should see your registered tools in the response.

## Next Steps

- Add `aiTool()` to endpoints you want LLMs to call
- Add `aiHidden()` to internal endpoints
- Add `aiReadOnly()` for documentation-only exposure
- Use `ragSearch.search(query)` for semantic API search
