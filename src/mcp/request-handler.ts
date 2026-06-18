import type { McpRequest, McpResponse } from './protocol';
import { mcpSuccess, mcpFailure } from './protocol';
import type { McpToolRegistry } from './tool-registry';
import type { McpToolExecutor } from './tool-executor';
import type { SlidingWindowRateLimiter } from './rate-limiter';
import type { McpOptions } from './options';
import { DEFAULT_MCP_OPTIONS } from './options';

/**
 * Handles incoming MCP JSON-RPC requests and routes them to the appropriate handler.
 */
export class McpRequestHandler {
  private readonly _options: Required<McpOptions>;

  constructor(
    private readonly _registry: McpToolRegistry,
    private readonly _executor: McpToolExecutor,
    private readonly _rateLimiter: SlidingWindowRateLimiter,
    options?: McpOptions,
  ) {
    this._options = { ...DEFAULT_MCP_OPTIONS, ...options };
  }

  /**
   * Processes an MCP request and returns the response.
   */
  async handle(request: McpRequest): Promise<McpResponse> {
    await this._registry.initialize();

    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request);
      case 'tools/list':
        return this.handleToolsList(request);
      case 'tools/call':
        return this.handleToolsCall(request);
      default:
        return mcpFailure(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  private handleInitialize(request: McpRequest): McpResponse {
    return mcpSuccess(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: this._options.serverName,
        version: this._options.serverVersion,
      },
    });
  }

  private handleToolsList(request: McpRequest): McpResponse {
    const tools = this._registry.getToolDefinitions();
    return mcpSuccess(request.id, { tools });
  }

  private async handleToolsCall(request: McpRequest): Promise<McpResponse> {
    const toolName = request.params?.name;
    if (!toolName) {
      return mcpFailure(request.id, -32602, 'Missing tool name');
    }

    const descriptor = this._registry.getTool(toolName);
    if (!descriptor) {
      return mcpFailure(request.id, -32602, `Unknown tool: ${toolName}`);
    }

    // Rate limiting check
    if (this._options.enableRateLimiting) {
      const limit = descriptor.rateLimitPerMinute ?? this._options.globalRateLimitPerMinute;
      if (!this._rateLimiter.tryAcquire(toolName, limit)) {
        return mcpFailure(request.id, -32000, `Rate limit exceeded for tool: ${toolName}`);
      }
    }

    try {
      const result = await this._executor.execute(descriptor, request.params?.arguments);
      return mcpSuccess(request.id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpFailure(request.id, -32000, `Tool execution failed: ${message}`);
    }
  }
}
