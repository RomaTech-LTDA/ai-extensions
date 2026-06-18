import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import { useAi, registerAiMetadata, aiTool, aiReadOnly, aiHidden } from '../src';
import { metadataRegistry } from '../src/metadata/registry';

describe('MCP Resources', () => {
  let handler: ReturnType<typeof useAi>['mcpHandler'];

  beforeAll(() => {
    metadataRegistry.clear();

    const app = express();
    app.use(express.json());

    app.get('/api/items', (_req, res) => res.json([{ id: 1 }]));
    app.post('/api/items', (req, res) => res.json(req.body));
    app.delete('/api/items/:id', (_req, res) => res.sendStatus(204));

    registerAiMetadata('GET', '/api/items', aiReadOnly({ description: 'List items' }));
    registerAiMetadata('POST', '/api/items', aiTool({ toolName: 'create_item' }));
    registerAiMetadata('DELETE', '/api/items/:id', aiHidden());

    const services = useAi(app, { baseUrl: 'http://localhost:9999' });
    handler = services.mcpHandler;
  });

  it('lists read-only GET endpoints as resources', async () => {
    const response = await handler.handle({ jsonrpc: '2.0', id: 1, method: 'resources/list' });
    const resources = (response.result as any).resources;

    expect(resources.length).toBeGreaterThanOrEqual(1);
    const itemsResource = resources.find((r: any) => r.uri === 'api:///api/items');
    expect(itemsResource).toBeDefined();
    expect(itemsResource.mimeType).toBe('application/json');
  });

  it('returns error for unknown resource URI', async () => {
    const response = await handler.handle({
      jsonrpc: '2.0', id: 2, method: 'resources/read',
      params: { uri: 'api:///nonexistent' },
    });
    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32602);
  });

  it('returns error when uri is missing', async () => {
    const response = await handler.handle({
      jsonrpc: '2.0', id: 3, method: 'resources/read',
      params: {},
    });
    expect(response.error).toBeDefined();
  });
});
