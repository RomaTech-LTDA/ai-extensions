# Getting Started

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

## Basic Setup (Decorator Pattern)

```typescript
import 'reflect-metadata';
import express from 'express';
import {
    Controller, Get, Post, Delete,
    AiTool, AiHidden, AiDescription, AiCategory,
    useController, useAi
} from '@romatech/ai-extensions';

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
    @AiDescription('Creates a new order')
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

// Register controller (routes + AI metadata from decorators)
useController(app, OrdersController);

// Enable AI (MCP + RAG)
useAi(app, { baseUrl: 'http://localhost:3000' });

app.listen(3000);
```

## Alternative: Manual Registration (no decorators)

If you prefer not to use decorators:

```typescript
import { useAi, registerAiMetadata, aiTool, aiHidden } from '@romatech/ai-extensions';

app.post('/api/orders', createHandler);
app.delete('/api/orders/:id', deleteHandler);

registerAiMetadata('POST', '/api/orders', aiTool('create_order'));
registerAiMetadata('DELETE', '/api/orders/:id', aiHidden());

useAi(app);
```

## Verify Installation

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You should see your `create_order` tool (plus `rag_search`) in the response.

## Other Frameworks

The same API works with Fastify, Koa, and Hono:

```typescript
// Fastify
import Fastify from 'fastify';
const fastify = Fastify();
useController(fastify, OrdersController);
useAi(fastify);
fastify.listen({ port: 3000 });

// Hono
import { Hono } from 'hono';
const app = new Hono();
useController(app, OrdersController);
useAi(app);
export default app;
```

## Next Steps

- Add `@AiTool()` to endpoints you want LLMs to call
- Add `@AiHidden()` to internal/dangerous endpoints
- Everything else becomes ReadOnly (RAG-searchable but not executable)
- See [MCP Protocol](./mcp.md) for all supported methods
- See [Security](./security.md) for auth configuration
