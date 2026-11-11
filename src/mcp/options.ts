import type { McpCallContext } from './protocol';
import type { McpHeaderSource } from './http-guard';

/**
 * What the `authenticate` hook receives: the incoming request, normalised across frameworks.
 */
export interface McpAuthenticationRequest {
  /** HTTP method (`POST` for MCP calls, `GET` when an SSE stream or WebSocket is opened). */
  method: string;
  /** The raw request headers (framework-specific shape; prefer `header()`). */
  headers: McpHeaderSource;
  /** Reads a request header case-insensitively. */
  header(name: string): string | undefined;
  /** The client address reported by the framework, when available. */
  clientId?: string;
  /** The framework's own request object (Express `req`, Koa `ctx`, Fetch `Request`, Lambda event...). */
  raw?: unknown;
}

/**
 * App-provided authentication for the MCP endpoint. Return the authenticated caller
 * (any truthy value, e.g. the decoded JWT or your user object) to accept the request, or a
 * falsy value to reject it with 401. A thrown error is also treated as a rejection.
 */
export type McpAuthenticateHook = (request: McpAuthenticationRequest) => unknown | Promise<unknown>;

/**
 * App-provided role lookup used to enforce `@AiRole(...)` / `aiTool({ role })`.
 * Receives the call context (with `principal` from `authenticate`) and returns the caller's roles.
 */
export type McpRoleResolver = (context: McpCallContext) => Iterable<string> | Promise<Iterable<string>>;

/**
 * Configuration options for the MCP layer.
 */
export interface McpOptions {
  /** The route for the MCP endpoint. Default: /mcp */
  route?: string;
  /** Whether to enable rate limiting on MCP tool calls. Default: true */
  enableRateLimiting?: boolean;
  /** Global rate limit (requests per minute) if no per-tool limit is set. Default: 60 */
  globalRateLimitPerMinute?: number;
  /** Server name reported in MCP initialize response. */
  serverName?: string;
  /** Server version reported in MCP initialize response. */
  serverVersion?: string;
  /**
   * API key for MCP endpoint authentication. If set, requests must include `Authorization: Bearer <key>`.
   * The MCP endpoint requires `apiKey`, `authenticate` or `allowAnonymous: true` (secure by default).
   */
  apiKey?: string;
  /**
   * Authenticates each MCP request (and each SSE stream / WebSocket upgrade) with your own logic,
   * e.g. by validating a session cookie or a JWT. Return the caller (truthy) to accept, falsy to
   * answer 401. When both `apiKey` and `authenticate` are set, both must pass.
   */
  authenticate?: McpAuthenticateHook;
  /**
   * Explicit opt-out of authentication: the MCP endpoint accepts anonymous callers.
   * Without `apiKey` or `authenticate`, the adapters refuse to start unless this is `true`.
   * Default: false
   */
  allowAnonymous?: boolean;
  /**
   * Returns the caller's roles, used to enforce `@AiRole(...)` / `aiTool({ role })`.
   * A role requirement such as `'admin,support'` is satisfied by any one of the listed roles.
   * Tools, resources and RAG results that declare a role are hidden and refused (fail closed)
   * when no resolver is configured, when it throws, or when the caller lacks the role.
   */
  resolveRoles?: McpRoleResolver;
  /**
   * Whether to forward the caller's credentials (the incoming `Authorization` and `Cookie`
   * headers) to the HTTP request that executes a tool, so the tool runs with the caller's
   * identity. When `apiKey` is set, an `Authorization` header carrying that MCP API key is
   * never forwarded. Default: false
   */
  forwardAuthorization?: boolean;
  /**
   * CORS allowed origins. Set to '*' for all, or an array of origins. Listed origins are also
   * accepted by the Origin check. Default: undefined (no CORS headers).
   */
  cors?: string | string[];
  /**
   * Browser origins allowed to call the MCP endpoint (e.g. `['https://admin.example.com']`).
   * Requests that carry an `Origin` header not listed here (or in `cors`) are rejected with 403,
   * as the MCP specification requires, to block cross-site requests and DNS rebinding.
   * Requests without an `Origin` header (non-browser MCP clients) are not affected.
   * Default: [] (no browser origin allowed unless `cors` is set).
   */
  allowedOrigins?: string[];
  /** Timeout in ms for tool execution. Default: 30000 */
  toolTimeoutMs?: number;
  /**
   * Maximum number of bytes read from a tool's HTTP response. Longer bodies are cut and marked
   * as truncated, so a large or endless response cannot exhaust memory. Default: 1048576 (1 MiB)
   */
  maxToolResponseBytes?: number;
  /**
   * Dry-run mode. When enabled, tools/call validates everything but does NOT execute.
   * Returns what would be called without side effects. Useful for testing.
   * Default: false
   */
  dryRun?: boolean;
}

/** `McpOptions` with every default applied (the hooks stay optional). */
export type ResolvedMcpOptions = Required<Omit<McpOptions, 'authenticate' | 'resolveRoles'>>
  & Pick<McpOptions, 'authenticate' | 'resolveRoles'>;

/** Package version, reported as the default `serverVersion`. Kept in sync with package.json by a test. */
export const PACKAGE_VERSION = '3.0.0';

export const DEFAULT_MCP_OPTIONS: ResolvedMcpOptions = {
  route: '/mcp',
  enableRateLimiting: true,
  globalRateLimitPerMinute: 60,
  serverName: '@romatech/ai-extensions',
  serverVersion: PACKAGE_VERSION,
  apiKey: '',
  allowAnonymous: false,
  forwardAuthorization: false,
  cors: '',
  allowedOrigins: [],
  toolTimeoutMs: 30_000,
  maxToolResponseBytes: 1024 * 1024,
  dryRun: false,
};

/** Merges user options over the defaults. */
export function resolveMcpOptions(options?: McpOptions): ResolvedMcpOptions {
  return { ...DEFAULT_MCP_OPTIONS, ...options };
}

/**
 * Throws when the MCP endpoint would be anonymous by accident: one of `apiKey`, `authenticate`
 * or `allowAnonymous: true` is required. Called by every transport/adapter factory.
 */
export function assertMcpAuthConfigured(options: McpOptions | undefined): void {
  if (options?.apiKey || typeof options?.authenticate === 'function' || options?.allowAnonymous === true) return;
  throw new Error(
    '@romatech/ai-extensions: the MCP endpoint requires authentication. Set mcp.apiKey, provide an '
    + 'mcp.authenticate(request) hook, or set mcp.allowAnonymous: true to expose it without authentication on purpose.',
  );
}
