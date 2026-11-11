import type { AiEndpointDescriptor } from '../shared/models';
import type { McpCallContext } from './protocol';

/** Default timeout for tool execution in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Default cap on the bytes read from a tool's HTTP response (1 MiB). */
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

/** Extra options for `McpToolExecutor`. */
export interface McpToolExecutorOptions {
  /** Maximum number of bytes read from a tool's HTTP response; the rest is dropped. Default: 1 MiB */
  maxResponseBytes?: number;
}

/**
 * A custom tool handler function. Receives arguments and the caller context, returns result.
 * Registered via `registerToolHandler()` to bypass HTTP roundtrip.
 */
export type ToolHandler = (args?: Record<string, unknown>, context?: McpCallContext) => Promise<unknown> | unknown;

/** Thrown when tool arguments cannot be turned into a safe request (e.g. path traversal). */
export class McpToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolArgumentError';
  }
}

/** Thrown when a tool's HTTP endpoint answers with a non-2xx status. */
export class McpToolHttpError extends Error {
  constructor(
    readonly toolName: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Tool ${toolName} returned HTTP ${status}`);
    this.name = 'McpToolHttpError';
  }
}

/** Thrown when a tool does not finish within the configured timeout. */
export class McpToolTimeoutError extends Error {
  constructor(toolName: string, timeoutMs: number) {
    super(`Tool ${toolName} timed out after ${timeoutMs}ms`);
    this.name = 'McpToolTimeoutError';
  }
}

/** OpenAPI `{name}` placeholders and Express `:name` placeholders (at the start of a segment). */
const PATH_PARAM = /\{([^{}/]+)\}|(?<=\/):([A-Za-z0-9_]+)/g;
const UNSAFE_PATH_VALUE = /[/\\\u0000-\u001f\u007f]/;
const BODY_METHODS = ['POST', 'PUT', 'PATCH'];

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
  private readonly _maxResponseBytes: number;

  constructor(
    private readonly _baseUrl: string,
    private readonly _timeoutMs: number = DEFAULT_TIMEOUT_MS,
    options?: McpToolExecutorOptions,
  ) {
    this._maxResponseBytes = Math.max(1, options?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  }

  /**
   * Registers a custom handler for a tool.
   * When this tool is called via MCP, the handler runs in-process
   * instead of making an HTTP request. It receives the caller context as its
   * second argument and is responsible for its own authorization.
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
   *
   * @throws McpToolArgumentError when the arguments cannot be mapped to a safe URL.
   * @throws McpToolHttpError when the endpoint answers with a non-2xx status.
   * @throws McpToolTimeoutError when the tool exceeds the timeout.
   */
  async execute(
    descriptor: AiEndpointDescriptor,
    args?: Record<string, unknown>,
    context?: McpCallContext,
  ): Promise<unknown> {
    // Priority 1: custom in-process handler (no HTTP)
    const handler = this._handlers.get(descriptor.toolName);
    if (handler) {
      return this.executeHandler(descriptor.toolName, handler, args, context);
    }

    // Priority 2: HTTP fetch
    return this.executeHttp(descriptor, args, context);
  }

  private async executeHandler(
    toolName: string,
    handler: ToolHandler,
    args?: Record<string, unknown>,
    context?: McpCallContext,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new McpToolTimeoutError(toolName, this._timeoutMs)), this._timeoutMs);
    });

    try {
      return await Promise.race([
        Promise.resolve().then(() => handler(args, context)),
        timeoutPromise,
      ]);
    } catch (err) {
      if (err instanceof McpToolTimeoutError || err instanceof McpToolArgumentError || err instanceof McpToolHttpError) {
        throw err;
      }
      throw new Error(`Tool ${toolName} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  private async executeHttp(
    descriptor: AiEndpointDescriptor,
    args?: Record<string, unknown>,
    context?: McpCallContext,
  ): Promise<unknown> {
    const method = descriptor.httpMethod.toUpperCase();
    const url = this.buildUrl(descriptor, method, args);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this._timeoutMs);

    const init: RequestInit = {
      method,
      headers: { ...context?.forwardHeaders, 'Content-Type': 'application/json' },
      signal: controller.signal,
      // Never follow redirects: a 3xx would send the request (and the forwarded caller
      // credentials) to a URL that was not validated by buildUrl(), e.g. a hidden route
      // or another host. A redirect is reported as a non-2xx tool result instead.
      redirect: 'manual',
    };

    if (BODY_METHODS.includes(method) && args) {
      init.body = JSON.stringify(args);
    }

    let response: Response;
    let text: string;
    let truncated: boolean;
    try {
      response = await fetch(url, init);
      ({ text, truncated } = await readBounded(response, this._maxResponseBytes));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new McpToolTimeoutError(descriptor.toolName, this._timeoutMs);
      }
      throw new Error(`Failed to execute tool ${descriptor.toolName}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    } finally {
      clearTimeout(timeout);
    }

    let body: unknown;
    if (truncated) {
      body = `${text}\n[response truncated: limit ${this._maxResponseBytes} bytes]`;
    } else {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      throw new McpToolHttpError(descriptor.toolName, response.status, body);
    }
    return body;
  }

  /**
   * Builds the request URL. Path parameters are validated and percent-encoded per segment,
   * so a value can never add segments, traverse with `..`, or inject a query string or
   * fragment. For methods without a body, the remaining arguments become query parameters.
   */
  private buildUrl(descriptor: AiEndpointDescriptor, method: string, args?: Record<string, unknown>): string {
    const pathArgs = new Set<string>();

    const path = descriptor.route.replace(PATH_PARAM, (_match, braced: string | undefined, colon: string | undefined) => {
      const name = (braced ?? colon) as string;
      const raw = args && Object.prototype.hasOwnProperty.call(args, name) ? args[name] : undefined;
      if (raw === undefined || raw === null || raw === '') {
        throw new McpToolArgumentError(`Missing required path parameter: ${name}`);
      }
      if (typeof raw === 'object') {
        throw new McpToolArgumentError(`Path parameter '${name}' must be a string or number`);
      }
      const value = String(raw);
      if (value === '.' || value === '..' || UNSAFE_PATH_VALUE.test(value)) {
        throw new McpToolArgumentError(`Invalid value for path parameter '${name}'`);
      }
      pathArgs.add(name);
      return encodeURIComponent(value);
    });

    const base = new URL(this._baseUrl);
    const url = new URL(`${this._baseUrl.replace(/\/+$/, '')}${path}`);
    if (url.origin !== base.origin) {
      throw new McpToolArgumentError(`Tool ${descriptor.toolName} resolved outside the API base URL`);
    }

    if (!BODY_METHODS.includes(method) && args) {
      for (const [key, value] of Object.entries(args)) {
        if (pathArgs.has(key) || value === undefined || value === null) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (item === undefined || item === null) continue;
          url.searchParams.append(key, typeof item === 'object' ? JSON.stringify(item) : String(item));
        }
      }
    }

    return url.toString();
  }
}

/**
 * Reads at most `maxBytes` of a response body, then cancels the stream, so a large or
 * never-ending response cannot exhaust memory.
 */
async function readBounded(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - received;
    if (value.byteLength > room) {
      if (room > 0) chunks.push(value.subarray(0, room));
      received = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    received += value.byteLength;
  }
  const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  // A cut can split a multi-byte character; TextDecoder (non-fatal) replaces the partial tail.
  return { text: new TextDecoder().decode(bytes), truncated };
}
