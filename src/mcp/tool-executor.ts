import type { AiEndpointDescriptor } from '../shared/models';
import type { Express } from 'express';

/** Default timeout for tool execution in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Executes MCP tool calls by forwarding to the underlying HTTP endpoint.
 * Uses in-process invocation when an Express app reference is available,
 * falls back to HTTP fetch otherwise.
 */
export class McpToolExecutor {
  constructor(
    private readonly _baseUrl: string,
    private readonly _app?: Express,
    private readonly _timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Executes a tool call against the underlying endpoint.
   */
  async execute(
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
