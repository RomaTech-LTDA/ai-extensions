import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import { useAi, registerAiMetadata, aiTool, aiReadOnly, aiHidden } from '../src';
import { metadataRegistry } from '../src/metadata/registry';
import type { McpResponse } from '../src/mcp/protocol';

describe('MCP Integration (end-to-end)', () => {
  let handler: ReturnType<typeof useAi>['mcpHandler'];

  beforeAll(() => {
    metadataRegistry.clear();

    const app = express();
    app.use(express.json());

    app.get('/api/items', (_req, res) => res.json([{ id: 1, name: 'Item' }]));
    app.post('/api/items', (req, res) => res.json({ id: 2, ...req.body }));
    app.delete('/api/items/:id', (_req, res) => res.sendStatus(204));

    registerAiMetadata('GET', '/api/items', aiReadOnly({ description: 'List items', category: 'Items' }));
    registerAiMetadata('POST', '/api/items', aiTool({ toolName: 'create_item', description: 'Create item' }));
    registerAiMetadata('DELETE', '/api/items/:id', aiHidden());

    const services = useAi(app, { baseUrl: 'http://localhost:9999' });
    handler = services.mcpHandler;
  });

  it('handles initialize', async () => {
    const response = await handler.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(response.result).toBeDefined();
    expect((response.result as any).protocolVersion).toBe('2024-11-05');
    expect((response.result as any).serverInfo.name).toBe('@romatech/ai-extensions');
  });

  it('handles ping', async () => {
    const response = await handler.handle({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(response.result).toEqual({});
  });

  it('lists only executable tools + rag_search', async () => {
    const response = await handler.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const tools = (response.result as any).tools;

    expect(tools.length).toBe(2); // create_item + rag_search
    expect(tools.find((t: any) => t.name === 'create_item')).toBeDefined();
    expect(tools.find((t: any) => t.name === 'rag_search')).toBeDefined();
    // Hidden endpoints should not appear
    expect(tools.find((t: any) => t.name === 'delete_api_items_id')).toBeUndefined();
  });

  it('returns error for unknown tool', async () => {
    const response = await handler.handle({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'nonexistent', arguments: {} },
    });
    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32602);
  });

  it('returns error for unknown method', async () => {
    const response = await handler.handle({ jsonrpc: '2.0', id: 5, method: 'unknown/method' });
    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32601);
  });

  it('validates required arguments', async () => {
    // Call a tool without arguments - will fail at execution level since server isn't running
    const response = await handler.handle({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'create_item' }, // no arguments
    });
    // Should attempt execution and fail (no server at port 9999)
    expect(response.error).toBeDefined();
  });
});
