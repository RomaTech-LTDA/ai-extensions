import { describe, it, expect, beforeEach } from 'vitest';
import { metadataRegistry } from '../src/metadata/registry';
import { registerAiMetadata, aiTool, aiHidden, aiReadOnly } from '../src/metadata/decorators';
import { MetadataDiscoveryProvider } from '../src/discovery/metadata-discovery-provider';
import { AiExposureLevel } from '../src/shared/models';

describe('MetadataDiscoveryProvider', () => {
  beforeEach(() => {
    metadataRegistry.clear();
  });

  it('discovers executable tools', async () => {
    registerAiMetadata('POST', '/api/orders', aiTool({ toolName: 'create_order', description: 'Creates order' }));
    registerAiMetadata('GET', '/api/orders', aiReadOnly({ description: 'List orders' }));
    registerAiMetadata('DELETE', '/api/orders/:id', aiHidden());

    const provider = new MetadataDiscoveryProvider();
    const endpoints = await provider.discoverEndpoints();

    expect(endpoints).toHaveLength(3);

    const tool = endpoints.find(e => e.toolName === 'create_order');
    expect(tool).toBeDefined();
    expect(tool!.exposureLevel).toBe(AiExposureLevel.Executable);

    const readonly = endpoints.find(e => e.httpMethod === 'GET');
    expect(readonly).toBeDefined();
    expect(readonly!.exposureLevel).toBe(AiExposureLevel.ReadOnly);

    const hidden = endpoints.find(e => e.httpMethod === 'DELETE');
    expect(hidden).toBeDefined();
    expect(hidden!.exposureLevel).toBe(AiExposureLevel.Hidden);
  });
});
