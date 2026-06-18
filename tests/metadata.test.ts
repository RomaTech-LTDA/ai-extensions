import { describe, it, expect, beforeEach } from 'vitest';
import { metadataRegistry } from '../src/metadata/registry';
import { aiTool, aiHidden, aiReadOnly, registerAiMetadata } from '../src/metadata/decorators';

describe('Metadata Registry', () => {
  beforeEach(() => {
    metadataRegistry.clear();
  });

  it('registers tool metadata', () => {
    registerAiMetadata('POST', '/api/orders', aiTool('create_order'));
    const entry = metadataRegistry.get('POST', '/api/orders');
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('tool');
    expect(entry!.toolName).toBe('create_order');
  });

  it('registers hidden metadata', () => {
    registerAiMetadata('DELETE', '/api/orders/:id', aiHidden());
    const entry = metadataRegistry.get('DELETE', '/api/orders/:id');
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('hidden');
  });

  it('registers readonly metadata with options', () => {
    registerAiMetadata('GET', '/api/orders', aiReadOnly({
      description: 'List orders',
      category: 'Orders',
    }));
    const entry = metadataRegistry.get('GET', '/api/orders');
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('readonly');
    expect(entry!.description).toBe('List orders');
    expect(entry!.category).toBe('Orders');
  });

  it('getAll returns all registered entries', () => {
    registerAiMetadata('GET', '/a', aiReadOnly());
    registerAiMetadata('POST', '/b', aiTool('b'));
    expect(metadataRegistry.getAll().size).toBe(2);
  });
});
