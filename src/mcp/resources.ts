import type { AiEndpointDescriptor, IEndpointDiscoveryProvider } from '../shared/models';
import { AiExposureLevel } from '../shared/models';

/**
 * MCP Resource definition.
 */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType: string;
}

/**
 * Manages MCP resources (read-only endpoints exposed as resources).
 */
export class McpResourceRegistry {
  private _resources: McpResource[] = [];
  private _descriptors = new Map<string, AiEndpointDescriptor>();
  private _initialized = false;

  constructor(private readonly _discoveryProvider: IEndpointDiscoveryProvider) {}

  async initialize(): Promise<void> {
    if (this._initialized) return;

    const endpoints = await this._discoveryProvider.discoverEndpoints();

    for (const endpoint of endpoints) {
      if (endpoint.exposureLevel === AiExposureLevel.ReadOnly && endpoint.httpMethod === 'GET') {
        const uri = `api://${endpoint.route}`;
        this._resources.push({
          uri,
          name: endpoint.toolName,
          description: endpoint.description,
          mimeType: 'application/json',
        });
        this._descriptors.set(uri, endpoint);
      }
    }

    this._initialized = true;
  }

  /**
   * Returns all registered resources for resources/list.
   */
  getResources(): McpResource[] {
    return this._resources;
  }

  /**
   * Gets the endpoint descriptor for a resource URI.
   */
  getDescriptor(uri: string): AiEndpointDescriptor | undefined {
    return this._descriptors.get(uri);
  }
}
