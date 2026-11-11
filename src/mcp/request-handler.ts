import type { McpCallContext, McpRequest, McpResponse, McpToolDefinition } from './protocol';
import { mcpSuccess, mcpFailure } from './protocol';
import type { McpToolRegistry } from './tool-registry';
import type { McpToolExecutor } from './tool-executor';
import { McpToolArgumentError, McpToolHttpError, McpToolTimeoutError } from './tool-executor';
import type { ILogger } from '../shared/logger';
import { ConsoleLogger } from '../shared/logger';
import type { SlidingWindowRateLimiter } from './rate-limiter';
import type { McpOptions, ResolvedMcpOptions } from './options';
import { resolveMcpOptions } from './options';
import type { RagSearchService } from '../rag/search-service';
import type { McpResourceRegistry } from './resources';
import type { McpMetrics } from './metrics';
import type { CircuitBreaker } from './circuit-breaker';
import type { McpAuditLog } from './audit-log';

/** Longest error body (in characters) returned to the client for a failed HTTP tool call. */
export const MAX_ERROR_BODY_CHARS = 2048;
/** Longest `rag_search` query accepted (in characters). */
export const MAX_RAG_QUERY_CHARS = 1024;

/** Checks a `requiredRole` against the caller; resolves the caller's roles at most once per request. */
type RoleGate = (requiredRole: string | undefined) => Promise<boolean>;

/**
 * Handles incoming MCP JSON-RPC requests and routes them to the appropriate handler.
 *
 * Authentication happens in the transports/adapters; this class enforces per-tool roles
 * (`@AiRole` / `aiTool({ role })`) through `McpOptions.resolveRoles` and fails closed when a
 * tool declares a role and no resolver is configured.
 */
export class McpRequestHandler {
  private readonly _options: ResolvedMcpOptions;
  private readonly _warnedRoles = new Set<string>();
  private _ragSearch?: RagSearchService;
  private _resources?: McpResourceRegistry;
  private _metrics?: McpMetrics;
  private _circuitBreaker?: CircuitBreaker;
  private _auditLog?: McpAuditLog;
  private _logger: ILogger = new ConsoleLogger();

  constructor(
    private readonly _registry: McpToolRegistry,
    private readonly _executor: McpToolExecutor,
    private readonly _rateLimiter: SlidingWindowRateLimiter,
    options?: McpOptions,
  ) {
    this._options = resolveMcpOptions(options);
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
   * Attaches a circuit breaker: a tool whose executions keep failing (timeouts, network errors,
   * HTTP 5xx, handler exceptions) is answered with `isError: true` without being executed until
   * the breaker lets a trial call through. HTTP 4xx answers do not count as failures, so callers
   * sending bad requests cannot switch a tool off for everyone.
   */
  attachCircuitBreaker(circuitBreaker: CircuitBreaker): void {
    this._circuitBreaker = circuitBreaker;
  }

  /**
   * Attaches an audit log: every executed `tools/call` (including `rag_search`) and
   * `resources/read`, and every call refused by the circuit breaker, is recorded.
   */
  attachAuditLog(auditLog: McpAuditLog): void {
    this._auditLog = auditLog;
  }

  /** Sets the logger that receives tool failure details (never sent to the client). */
  attachLogger(logger: ILogger): void {
    this._logger = logger;
  }

  /**
   * Processes an MCP request and returns the response, or `null` for a JSON-RPC notification
   * (a message without `id`), which gets no response: HTTP adapters answer `202 Accepted`
   * without a body. Notifications never execute tools.
   *
   * @param context - Caller information built by the HTTP adapter: credentials to forward
   *   to tool requests, the client id used for per-client rate limiting and the authenticated
   *   principal used by `resolveRoles`.
   */
  async handle(request: McpRequest, context?: McpCallContext): Promise<McpResponse | null> {
    if (request.id === undefined) {
      return null;
    }

    await this._registry.initialize();
    const roles = this.createRoleGate(context);

    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request);
      case 'notifications/initialized':
        // Legacy clients send notifications/initialized with an id.
        return mcpSuccess(request.id, {});
      case 'ping':
        return mcpSuccess(request.id, {});
      case 'tools/list':
        return this.handleToolsList(request, roles);
      case 'tools/call':
        return this.handleToolsCall(request, roles, context);
      case 'resources/list':
        return this.handleResourcesList(request, roles);
      case 'resources/read':
        return this.handleResourcesRead(request, roles, context);
      case 'completions/complete':
        return this.handleCompletions(request, roles);
      case 'prompts/list':
        return this.handlePromptsList(request);
      case 'prompts/get':
        return this.handlePromptsGet(request, roles);
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

  /**
   * Builds the role check for one request. A requirement such as `'admin,support'` is met by any
   * listed role. Fails closed: no resolver, a throwing resolver or a missing role all deny.
   */
  private createRoleGate(context?: McpCallContext): RoleGate {
    let roles: Promise<Set<string> | null> | undefined;
    return async (requiredRole) => {
      if (requiredRole === undefined || requiredRole === null || requiredRole === '') return true;
      const resolver = this._options.resolveRoles;
      if (!resolver) {
        if (!this._warnedRoles.has(requiredRole)) {
          this._warnedRoles.add(requiredRole);
          this._logger.warn('MCP tools that require a role are hidden: no mcp.resolveRoles is configured', { role: requiredRole });
        }
        return false;
      }
      roles ??= (async () => {
        try {
          const result = await resolver(context ?? {});
          if (typeof result === 'string') return new Set([result]);
          return new Set(result ?? []);
        } catch (err) {
          this._logger.error('MCP role resolver failed; role-restricted tools are denied', { error: err instanceof Error ? err : String(err) });
          return null;
        }
      })();
      const granted = await roles;
      if (!granted) return false;
      return String(requiredRole).split(',').map((r) => r.trim()).filter(Boolean).some((r) => granted.has(r));
    };
  }

  /** Tool definitions the caller may see (role-restricted tools are hidden). */
  private async visibleToolDefinitions(roles: RoleGate): Promise<McpToolDefinition[]> {
    const visible: McpToolDefinition[] = [];
    for (const definition of this._registry.getToolDefinitions()) {
      if (await roles(this._registry.getTool(definition.name)?.requiredRole)) visible.push(definition);
    }
    return visible;
  }

  private async handleToolsList(request: McpRequest, roles: RoleGate): Promise<McpResponse> {
    let tools = await this.visibleToolDefinitions(roles);

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

  private async handleToolsCall(request: McpRequest, roles: RoleGate, context?: McpCallContext): Promise<McpResponse> {
    const toolName = request.params?.name;
    if (!toolName || typeof toolName !== 'string') {
      return mcpFailure(request.id, -32602, 'Missing tool name');
    }

    const args = request.params?.arguments;
    if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
      return mcpFailure(request.id, -32602, 'Tool arguments must be an object');
    }

    // Built-in rag_search
    if (toolName === 'rag_search' && this._ragSearch) {
      if (!this.tryAcquire(context, 'rag_search')) {
        return mcpFailure(request.id, -32000, 'Rate limit exceeded for tool: rag_search');
      }
      return this.handleRagSearch(request, roles, context);
    }

    const descriptor = this._registry.getTool(toolName);
    // Unknown and role-restricted tools look the same to callers that may not use them.
    if (!descriptor || !(await roles(descriptor.requiredRole))) {
      return mcpFailure(request.id, -32602, `Unknown tool: ${toolName}`);
    }

    // Validate arguments
    if (descriptor.inputSchema) {
      const validationError = this.validateArguments(descriptor.inputSchema, args);
      if (validationError) {
        return mcpFailure(request.id, -32602, validationError);
      }
    }

    // Rate limiting
    if (!this.tryAcquire(context, toolName, descriptor.rateLimitPerMinute)) {
      return mcpFailure(request.id, -32000, `Rate limit exceeded for tool: ${toolName}`);
    }

    // Dry-run mode — validate everything but don't execute
    if (this._options.dryRun) {
      return mcpSuccess(request.id, {
        content: [{
          type: 'text',
          text: JSON.stringify({
            dryRun: true,
            toolName,
            httpMethod: descriptor.httpMethod,
            route: descriptor.route,
            arguments: args ?? {},
            message: 'Validation passed. Tool would be executed with these parameters.',
          }),
        }],
      });
    }

    if (this._circuitBreaker && !this._circuitBreaker.canExecute(toolName)) {
      this.audit('tools/call', toolName, args, context, 0, 'circuit open');
      return mcpSuccess(request.id, {
        content: [{ type: 'text', text: JSON.stringify({ error: `Tool ${toolName} is temporarily unavailable` }) }],
        isError: true,
      });
    }

    const startTime = Date.now();
    try {
      const result = await this._executor.execute(descriptor, args, context);
      const duration = Date.now() - startTime;
      this._metrics?.recordCall(toolName, duration);
      this._circuitBreaker?.recordSuccess(toolName);
      this.audit('tools/call', toolName, args, context, duration);
      return mcpSuccess(request.id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      });
    } catch (err) {
      const duration = Date.now() - startTime;
      this._metrics?.recordError(toolName, duration);
      this.audit('tools/call', toolName, args, context, duration, err);
      if (err instanceof McpToolArgumentError) {
        return mcpFailure(request.id, -32602, err.message);
      }
      if (isUpstreamFailure(err)) this._circuitBreaker?.recordFailure(toolName);
      else this._circuitBreaker?.recordSuccess(toolName);
      // Per the MCP spec, tool execution failures are results with isError: true
      // (so the model can see and react to them), not JSON-RPC protocol errors.
      return mcpSuccess(request.id, {
        content: [{ type: 'text', text: this.describeToolError(toolName, err) }],
        isError: true,
      });
    }
  }

  /**
   * Takes a rate-limit permit for `bucket`. One bucket per client and per tool/resource,
   * so one caller cannot exhaust the quota of the others. Every call that does work
   * (tools/call, rag_search, resources/read) goes through here.
   */
  private tryAcquire(context: McpCallContext | undefined, bucket: string, limit?: number): boolean {
    if (!this._options.enableRateLimiting) return true;
    const clientKey = rateLimitClientKey(context?.clientId);
    return this._rateLimiter.tryAcquire(`${clientKey}|${bucket}`, limit ?? this._options.globalRateLimitPerMinute);
  }

  /**
   * Text shown to the client for a failed tool. HTTP errors carry the API's own response
   * (what the caller would get by calling the endpoint directly); anything else is logged
   * server-side and replaced by a generic message so internals never leak.
   */
  private describeToolError(toolName: string, err: unknown): string {
    if (err instanceof McpToolHttpError) {
      // Error pages can be large and carry internals (e.g. a development stack trace): cap them.
      const serialized = typeof err.body === 'string' ? err.body : JSON.stringify(err.body) ?? '';
      const body = serialized.length <= MAX_ERROR_BODY_CHARS
        ? err.body
        : `${serialized.slice(0, MAX_ERROR_BODY_CHARS)}... [truncated: ${serialized.length} characters]`;
      return JSON.stringify({ error: `HTTP ${err.status}`, status: err.status, body });
    }
    if (err instanceof McpToolTimeoutError) {
      return JSON.stringify({ error: err.message });
    }
    this._logger.error('MCP tool execution failed', { tool: toolName, error: err instanceof Error ? err : String(err) });
    return JSON.stringify({ error: `Tool ${toolName} failed due to an internal error` });
  }

  private async handleResourcesList(request: McpRequest, roles: RoleGate): Promise<McpResponse> {
    if (!this._resources) {
      return mcpSuccess(request.id, { resources: [] });
    }
    await this._resources.initialize();
    const resources = [];
    for (const resource of this._resources.getResources()) {
      if (await roles(this._resources.getDescriptor(resource.uri)?.requiredRole)) resources.push(resource);
    }
    return mcpSuccess(request.id, { resources });
  }

  private async handleResourcesRead(request: McpRequest, roles: RoleGate, context?: McpCallContext): Promise<McpResponse> {
    const uri = request.params?.uri as string | undefined;
    if (!uri) {
      return mcpFailure(request.id, -32602, 'Missing required parameter: uri');
    }

    if (!this._resources) {
      return mcpFailure(request.id, -32602, `Unknown resource: ${uri}`);
    }

    await this._resources.initialize();
    const descriptor = this._resources.getDescriptor(uri);
    if (!descriptor || !(await roles(descriptor.requiredRole))) {
      return mcpFailure(request.id, -32602, `Unknown resource: ${uri}`);
    }

    // Resources perform a real GET on the API: rate-limit them like tools.
    if (!this.tryAcquire(context, `resource:${descriptor.toolName}`, descriptor.rateLimitPerMinute)) {
      return mcpFailure(request.id, -32000, `Rate limit exceeded for resource: ${uri}`);
    }

    // Fetch the resource content
    const startTime = Date.now();
    try {
      const result = await this._executor.execute(descriptor, undefined, context);
      this.audit('resources/read', descriptor.toolName, undefined, context, Date.now() - startTime);
      return mcpSuccess(request.id, {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(result),
        }],
      });
    } catch (err) {
      this.audit('resources/read', descriptor.toolName, undefined, context, Date.now() - startTime, err);
      if (err instanceof McpToolHttpError) {
        return mcpFailure(request.id, -32000, `Resource read failed: HTTP ${err.status}`);
      }
      if (err instanceof McpToolArgumentError) {
        return mcpFailure(request.id, -32602, err.message);
      }
      this._logger.error('MCP resource read failed', { uri, error: err instanceof Error ? err : String(err) });
      return mcpFailure(request.id, -32603, 'Resource read failed');
    }
  }

  /** Records one execution in the attached audit log (no-op without one). */
  private audit(
    method: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    context: McpCallContext | undefined,
    durationMs: number,
    error?: unknown,
  ): void {
    if (!this._auditLog) return;
    const failed = error !== undefined;
    this._auditLog.record({
      toolName,
      method,
      arguments: args,
      durationMs,
      success: !failed,
      error: failed ? (error instanceof Error ? error.message : String(error)) : undefined,
      clientId: context?.clientId,
    });
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

  private async handleRagSearch(request: McpRequest, roles: RoleGate, context?: McpCallContext): Promise<McpResponse> {
    const query = request.params?.arguments?.query;
    if (!query || typeof query !== 'string') {
      return mcpFailure(request.id, -32602, 'Missing required parameter: query');
    }
    if (query.length > MAX_RAG_QUERY_CHARS) {
      return mcpFailure(request.id, -32602, `Parameter 'query' must be at most ${MAX_RAG_QUERY_CHARS} characters`);
    }

    const startTime = Date.now();
    try {
      const results = await this._ragSearch!.search(query);
      this._metrics?.recordCall('rag_search', Date.now() - startTime);
      this.audit('tools/call', 'rag_search', { query }, context, Date.now() - startTime);
      const allowed = [];
      for (const r of results) {
        if (await roles(r.document.requiredRole)) allowed.push(r);
      }
      const formatted = allowed.map((r) => ({
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
      this.audit('tools/call', 'rag_search', { query }, context, Date.now() - startTime, err);
      this._logger.error('MCP rag_search failed', { error: err instanceof Error ? err : String(err) });
      return mcpSuccess(request.id, {
        content: [{ type: 'text', text: JSON.stringify({ error: 'RAG search failed due to an internal error' }) }],
        isError: true,
      });
    }
  }

  private async handleCompletions(request: McpRequest, roles: RoleGate): Promise<McpResponse> {
    const ref = request.params?.ref as { type?: string; name?: string } | undefined;
    const argName = request.params?.argument as { name?: string; value?: string } | undefined;

    if (!ref) {
      return mcpSuccess(request.id, { completion: { values: [] } });
    }

    // Provide tool name completions
    if (ref.type === 'ref/tool' && !argName) {
      const tools = await this.visibleToolDefinitions(roles);
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
      if (tool?.inputSchema && await roles(tool.requiredRole)) {
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

  private async handlePromptsGet(request: McpRequest, roles: RoleGate): Promise<McpResponse> {
    const promptName = request.params?.name;

    if (promptName === 'list_available_tools') {
      const tools = await this.visibleToolDefinitions(roles);
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

/**
 * True when a tool failure says the tool itself is unhealthy (timeout, network error, HTTP 5xx,
 * handler exception), as opposed to a caller error (HTTP 4xx, redirect, bad arguments).
 */
function isUpstreamFailure(err: unknown): boolean {
  if (err instanceof McpToolArgumentError) return false;
  if (err instanceof McpToolHttpError) return err.status >= 500;
  return true;
}

/**
 * Rate-limit key for a client address. IPv6 addresses are grouped by their /64 prefix, because
 * a single host usually controls a whole /64 and could otherwise rotate addresses to get a fresh
 * bucket on every call. IPv4 (including IPv4-mapped IPv6) and non-IP ids are used as they are.
 */
export function rateLimitClientKey(clientId: string | undefined): string {
  if (!clientId) return 'anonymous';
  const id = clientId.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!id.includes(':')) return id;
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(id)) return id.slice(7);
  const halves = id.split('::');
  if (halves.length > 2) return id;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return id;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return id;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
