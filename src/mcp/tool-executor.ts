import type { AiEndpointDescriptor } from '../shared/models';

/** Default timeout for tool execution in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * A custom tool handler function. Receives arguments, returns result.
 * Registered via `registerToolHandler()` to bypass HTTP roundtrip.
 */
export type ToolHandler = (args?: Record<string, unknown>) => Promise<unknown> | unknown;

/**
 * Executes MCP tool calls.
 *
 * Priority:
 * 1. Custom handler (in-process, no HTTP) — registered via registerToolHandler()
 * 2. HTTP fetch to the underlying endpoint (fallback)
 *
 * Custom handlers eliminate the self-call HTTP roundtrip that can cause
 * deadlocks under load. Use them for tools that don't need to go through
 * the full HTTP pipeline.
 */
export class McpToolExecutor {
  private readonly _handlers = new Map<string, ToolHandler>();

  constructor(
    private readonly _baseUrl: string,
    private readonly _timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Registers a custom handler for a tool.
   * When this tool is called via MCP, the handler runs in-process
   * instead of making an HTTP request.
   *
   * @example
   * ```ts
   * executor.registerHandler('create_order', async (args) => {
   *     const order = await orderService.create(args);
   *     return order;
   * });
   * ```
   */
  registerHandler(toolName: string, handler: ToolHandler): void {
    this._handlers.set(toolName, handler);
  }

  /**
   * Removes a custom handler, reverting to HTTP execution.
   */
  removeHandler(toolName: string): void {
    this._handlers.delete(toolName);
  }

  /**
   * Executes a tool call.
   * Uses custom handler if registered, otherwise falls back to HTTP.
   */
  async execute(
    descriptor: AiEndpointDescriptor,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    // Priority 1: custom in-process handler (no HTTP)
    const handler = this._handlers.get(descriptor.toolName);
    if (handler) {
      return this.executeHandler(descriptor.toolName, handler, args);
    }

    // Priority 2: HTTP fetch
    return this.executeHttp(descriptor, args);
  }

  private async executeHandler(
    toolName: string,
    handler: ToolHandler,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Tool ${toolName} timed out after ${this._timeoutMs}ms`)), this._timeoutMs);
    });

    try {
      return await Promise.race([
        Promise.resolve(handler(args)),
        timeoutPromise,
      ]);
    } catch (err) {
      throw new Error(`Tool ${toolName} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async executeHttp(
    descriptor: AiEndpointDescriptor,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    const route = this.buildRoute(descriptor.route, args);
    const url = `${this._baseUrl}${route}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this._timeoutMs);

    const init: RequestInit = {
      method: descriptor.httpMethod,
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    };

    if (['POST', 'PUT', 'PATCH'].includes(descriptor.httpMethod) && args) {
      init.body = JSON.stringify(args);
    }

    try {
      const response = await fetch(url, init);
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Tool ${descriptor.toolName} timed out after ${this._timeoutMs}ms`);
      }
      throw new Error(`Failed to execute tool ${descriptor.toolName}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRoute(routeTemplate: string, args?: Record<string, unknown>): string {
    if (!args) return routeTemplate;
    let route = routeTemplate;
    for (const [key, value] of Object.entries(args)) {
      route = route.replace(`{${key}}`, String(value ?? ''));
      route = route.replace(`:${key}`, String(value ?? ''));
    }
    return route;
  }
}
