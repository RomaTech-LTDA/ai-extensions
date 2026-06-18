import type { AiEndpointDescriptor } from '../shared/models';

/**
 * Executes MCP tool calls by forwarding to the underlying HTTP endpoint.
 */
export class McpToolExecutor {
  constructor(private readonly _baseUrl: string) {}

  /**
   * Executes a tool call against the underlying endpoint.
   */
  async execute(
    descriptor: AiEndpointDescriptor,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    const route = this.buildRoute(descriptor.route, args);
    const url = `${this._baseUrl}${route}`;

    const init: RequestInit = {
      method: descriptor.httpMethod,
      headers: { 'Content-Type': 'application/json' },
    };

    if (['POST', 'PUT', 'PATCH'].includes(descriptor.httpMethod) && args) {
      init.body = JSON.stringify(args);
    }

    const response = await fetch(url, init);
    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch {
      return text;
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
