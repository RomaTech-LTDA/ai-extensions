import type { AiEndpointDescriptor, IEndpointDiscoveryProvider } from '../shared/models';
import { AiExposureLevel } from '../shared/models';
import type { McpToolDefinition } from './protocol';

/**
 * Registry that manages discovered MCP tools and handles tool listing.
 */
export class McpToolRegistry {
  private readonly _tools = new Map<string, AiEndpointDescriptor>();
  private _initialized = false;

  constructor(private readonly _discoveryProvider: IEndpointDiscoveryProvider) {}

  /**
   * Initializes the tool registry by discovering endpoints.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    const endpoints = await this._discoveryProvider.discoverEndpoints();

    for (const endpoint of endpoints) {
      if (endpoint.exposureLevel === AiExposureLevel.Executable) {
        this._tools.set(endpoint.toolName, endpoint);
      }
    }

    this._initialized = true;
  }

  /**
   * Returns all registered tool definitions for the tools/list response.
   */
  getToolDefinitions(): McpToolDefinition[] {
    return Array.from(this._tools.values()).map((endpoint) => ({
      name: endpoint.toolName,
      description: endpoint.description,
      inputSchema: endpoint.inputSchema ?? undefined,
    }));
  }

  /**
   * Tries to get an endpoint descriptor for a given tool name.
   */
  getTool(toolName: string): AiEndpointDescriptor | undefined {
    return this._tools.get(toolName);
  }

  /**
   * Returns all registered endpoints (including read-only) for RAG indexing.
   */
  async getAllEndpoints(): Promise<AiEndpointDescriptor[]> {
    return this._discoveryProvider.discoverEndpoints();
  }
}
