import type { McpRequest, McpResponse } from './protocol';
import { mcpSuccess, mcpFailure } from './protocol';
import type { McpToolRegistry } from './tool-registry';
import type { McpToolExecutor } from './tool-executor';
import type { SlidingWindowRateLimiter } from './rate-limiter';
import type { McpOptions } from './options';
import { DEFAULT_MCP_OPTIONS } from './options';
import type { RagSearchService } from '../rag/search-service';
import type { McpResourceRegistry } from './resources';
import type { McpMetrics } from './metrics';

/**
 * Handles incoming MCP JSON-RPC requests and routes them to the appropriate handler.
 */
export class McpRequestHandler {
  private readonly _options: Required<McpOptions>;
  private _ragSearch?: RagSearchService;
  private _resources?: McpResourceRegistry;
  private _metrics?: McpMetrics;

  constructor(
    private readonly _registry: McpToolRegistry,
    private readonly _executor: McpToolExecutor,
    private readonly _rateLimiter: SlidingWindowRateLimiter,
    options?: McpOptions,
  ) {
    this._options = { ...DEFAULT_MCP_OPTIONS, ...options };
  }

  /** Attaches the RAG search service to enable the built-in rag_search tool. */
  attachRagSearch(ragSearch: RagSearchService): void {
    this._ragSearch = ragSearch;
  }

  /** Attaches the resource registry for resources/list and resources/read. */
  attachResources(resources: McpResourceRegistry): void {
    this._resources = resources;
  }

  /** Attaches metrics collector for tool usage tracking. */
  attachMetrics(metrics: McpMetrics): void {
    this._metrics = metrics;
  }

  /**
   * Processes an MCP request and returns the response.
   */
  async handle(request: McpRequest): Promise<McpResponse> {
    await this._registry.initialize();

    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request);
      case 'notifications/initialized':
        return mcpSuccess(request.id, {});
      case 'ping':
        return mcpSuccess(request.id, {});
      case 'tools/list':
        return this.handleToolsList(request);
      case 'tools/call':
        return this.handleToolsCall(request);
      case 'resources/list':
        return this.handleResourcesList(request);
      case 'resources/read':
        return this.handleResourcesRead(request);
      case 'completions/complete':
        return this.handleCompletions(request);
      case 'prompts/list':
        return this.handlePromptsList(request);
      case 'prompts/get':
        return this.handlePromptsGet(request);
      default:
        return mcpFailure(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  private handleInitialize(request: McpRequest): McpResponse {
    const capabilities: Record<string, unknown> = {
      tools: { listChanged: true },
      completions: {},
      prompts: { listChanged: false },
    };

    if (this._resources) {
      capabilities.resources = { subscribe: false, listChanged: false };
    }

    return mcpSuccess(request.id, {
      protocolVersion: '2024-11-05',
      capabilities,
      serverInfo: {
        name: this._options.serverName,
        version: this._options.serverVersion,
      },
    });
  }

  private handleToolsList(request: McpRequest): McpResponse {
    let tools = this._registry.getToolDefinitions();

    // Built-in rag_search tool
    if (this._ragSearch) {
      tools.push({
        name: 'rag_search',
        description: 'Searches API documentation semantically. Returns relevant endpoints ranked by similarity.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language search query' },
          },
          required: ['query'],
        },
      });
    }

    // Cursor-based pagination
    const cursor = request.params?.cursor;
    const pageSize = 50;
    let nextCursor: string | undefined;

    if (cursor) {
      const startIndex = parseInt(cursor, 10);
      if (!isNaN(startIndex)) {
        tools = tools.slice(startIndex);
      }
    }

    if (tools.length > pageSize) {
      const cursorStart = cursor ? parseInt(cursor, 10) || 0 : 0;
      nextCursor = String(cursorStart + pageSize);
      tools = tools.slice(0, pageSize);
    }

    const result: Record<string, unknown> = { tools };
    if (nextCursor) {
      result.nextCursor = nextCursor;
    }

    return mcpSuccess(request.id, result);
  }

  private async handleToolsCall(request: McpRequest): Promise<McpResponse> {
    const toolName = request.params?.name;
    if (!toolName) {
      return mcpFailure(request.id, -32602, 'Missing tool name');
    }

    // Built-in rag_search
    if (toolName === 'rag_search' && this._ragSearch) {
      return this.handleRagSearch(request);
    }

    const descriptor = this._registry.getTool(toolName);
    if (!descriptor) {
      return mcpFailure(request.id, -32602, `Unknown tool: ${toolName}`);
    }

    // Validate arguments
    if (descriptor.inputSchema) {
      const validationError = this.validateArguments(descriptor.inputSchema, request.params?.arguments);
      if (validationError) {
        return mcpFailure(request.id, -32602, validationError);
      }
    }

    // Rate limiting
    if (this._options.enableRateLimiting) {
      const limit = descriptor.rateLimitPerMinute ?? this._options.globalRateLimitPerMinute;
      if (!this._rateLimiter.tryAcquire(toolName, limit)) {
        return mcpFailure(request.id, -32000, `Rate limit exceeded for tool: ${toolName}`);
      }
    }

    const startTime = Date.now();
    try {
      const result = await this._executor.execute(descriptor, request.params?.arguments);
      this._metrics?.recordCall(toolName, Date.now() - startTime);
      return mcpSuccess(request.id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      });
    } catch (err) {
      this._metrics?.recordError(toolName, Date.now() - startTime);
      const message = err instanceof Error ? err.message : String(err);
      return mcpFailure(request.id, -32000, `Tool execution failed: ${message}`);
    }
  }

  private async handleResourcesList(request: McpRequest): Promise<McpResponse> {
    if (!this._resources) {
      return mcpSuccess(request.id, { resources: [] });
    }
    await this._resources.initialize();
    return mcpSuccess(request.id, { resources: this._resources.getResources() });
  }

  private async handleResourcesRead(request: McpRequest): Promise<McpResponse> {
    const uri = request.params?.uri as string | undefined;
    if (!uri) {
      return mcpFailure(request.id, -32602, 'Missing required parameter: uri');
    }

    if (!this._resources) {
      return mcpFailure(request.id, -32602, `Unknown resource: ${uri}`);
    }

    await this._resources.initialize();
    const descriptor = this._resources.getDescriptor(uri);
    if (!descriptor) {
      return mcpFailure(request.id, -32602, `Unknown resource: ${uri}`);
    }

    // Fetch the resource content
    try {
      const result = await this._executor.execute(descriptor);
      return mcpSuccess(request.id, {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(result),
        }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpFailure(request.id, -32000, `Resource read failed: ${message}`);
    }
  }

  private validateArguments(schema: object, args?: Record<string, unknown>): string | null {
    const s = schema as { required?: string[]; properties?: Record<string, { type?: string }> };
    if (s.required) {
      for (const field of s.required) {
        if (!args || args[field] === undefined || args[field] === null) {
          return `Missing required parameter: ${field}`;
        }
      }
    }
    if (s.properties && args) {
      for (const [key, prop] of Object.entries(s.properties)) {
        if (args[key] !== undefined && prop.type) {
          const actual = typeof args[key];
          if (prop.type === 'number' && actual !== 'number') {
            return `Parameter '${key}' must be a number, got ${actual}`;
          }
          if (prop.type === 'string' && actual !== 'string') {
            return `Parameter '${key}' must be a string, got ${actual}`;
          }
          if (prop.type === 'boolean' && actual !== 'boolean') {
            return `Parameter '${key}' must be a boolean, got ${actual}`;
          }
        }
      }
    }
    return null;
  }

  private async handleRagSearch(request: McpRequest): Promise<McpResponse> {
    const query = request.params?.arguments?.query as string | undefined;
    if (!query) {
      return mcpFailure(request.id, -32602, 'Missing required parameter: query');
    }

    const startTime = Date.now();
    try {
      const results = await this._ragSearch!.search(query);
      this._metrics?.recordCall('rag_search', Date.now() - startTime);
      const formatted = results.map((r) => ({
        toolName: r.document.toolName,
        method: r.document.httpMethod,
        route: r.document.route,
        category: r.document.category,
        score: Math.round(r.score * 100) / 100,
      }));

      return mcpSuccess(request.id, {
        content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }],
      });
    } catch (err) {
      this._metrics?.recordError('rag_search', Date.now() - startTime);
      const message = err instanceof Error ? err.message : String(err);
      return mcpFailure(request.id, -32000, `RAG search failed: ${message}`);
    }
  }

  private handleCompletions(request: McpRequest): McpResponse {
    const ref = request.params?.ref as { type?: string; name?: string } | undefined;
    const argName = request.params?.argument as { name?: string; value?: string } | undefined;

    if (!ref) {
      return mcpSuccess(request.id, { completion: { values: [] } });
    }

    // Provide tool name completions
    if (ref.type === 'ref/tool' && !argName) {
      const tools = this._registry.getToolDefinitions();
      const prefix = (ref.name ?? '').toLowerCase();
      const values = tools
        .map((t) => t.name)
        .filter((n) => n.toLowerCase().startsWith(prefix))
        .slice(0, 10);
      return mcpSuccess(request.id, { completion: { values } });
    }

    // Provide argument value completions based on schema enums
    if (ref.type === 'ref/tool' && argName?.name) {
      const tool = this._registry.getTool(ref.name ?? '');
      if (tool?.inputSchema) {
        const schema = tool.inputSchema as { properties?: Record<string, { enum?: string[] }> };
        const prop = schema.properties?.[argName.name];
        if (prop?.enum) {
          const prefix = (argName.value ?? '').toLowerCase();
          const values = prop.enum.filter((v) => v.toLowerCase().startsWith(prefix));
          return mcpSuccess(request.id, { completion: { values } });
        }
      }
    }

    return mcpSuccess(request.id, { completion: { values: [] } });
  }

  private handlePromptsList(request: McpRequest): McpResponse {
    // Built-in prompts for common API interactions
    const prompts = [
      {
        name: 'list_available_tools',
        description: 'Describes all available API tools and their capabilities',
      },
      {
        name: 'search_api',
        description: 'Searches the API documentation for relevant endpoints',
        arguments: [
          { name: 'query', description: 'What to search for', required: true },
        ],
      },
    ];

    return mcpSuccess(request.id, { prompts });
  }

  private handlePromptsGet(request: McpRequest): McpResponse {
    const promptName = request.params?.name;

    if (promptName === 'list_available_tools') {
      const tools = this._registry.getToolDefinitions();
      const description = tools
        .map((t) => `- **${t.name}**: ${t.description ?? 'No description'}`)
        .join('\n');

      return mcpSuccess(request.id, {
        messages: [{
          role: 'user',
          content: { type: 'text', text: `Here are the available API tools:\n\n${description}` },
        }],
      });
    }

    if (promptName === 'search_api') {
      const query = request.params?.arguments?.query as string ?? 'all endpoints';
      return mcpSuccess(request.id, {
        messages: [{
          role: 'user',
          content: { type: 'text', text: `Search the API documentation for: "${query}". Use the rag_search tool with this query.` },
        }],
      });
    }

    return mcpFailure(request.id, -32602, `Unknown prompt: ${promptName}`);
  }
}
