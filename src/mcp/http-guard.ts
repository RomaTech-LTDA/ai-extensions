import { createHash, timingSafeEqual } from 'node:crypto';
import type { McpCallContext, McpResponse } from './protocol';
import { mcpFailure } from './protocol';
import type { McpOptions } from './options';

/**
 * Request headers as exposed by the supported frameworks: a Node/Express/Koa/Fastify
 * header record, a Lambda header map, or a Fetch API `Headers` object.
 */
export type McpHeaderSource =
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null }
  | undefined
  | null;

/** Outcome of `guardMcpHttpRequest()`. */
export interface McpHttpGuardResult {
  /** True when the request may be handed to `McpRequestHandler.handle()`. */
  ok: boolean;
  /** HTTP status to answer with when `ok` is false (204 for an accepted CORS preflight). */
  status: number;
  /** JSON body to answer with when `ok` is false (absent for 204). */
  body?: McpResponse;
  /** Response headers to set in every case (CORS). */
  headers: Record<string, string>;
  /** The caller returned by the `authenticate` hook, when one is configured. */
  principal?: unknown;
}

type GuardOptions = Pick<McpOptions, 'apiKey' | 'cors' | 'allowedOrigins' | 'authenticate' | 'allowAnonymous'>;

/** Reads a header case-insensitively from any supported header source. */
export function getHeader(headers: McpHeaderSource, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(name: string): string | null }).get(name) ?? undefined;
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() !== wanted || value === undefined) continue;
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
  return undefined;
}

/**
 * True when the media type is exactly `application/json` (parameters such as charset allowed).
 * A substring check is not enough: `text/plain; x=application/json` is a CORS "simple"
 * request that browsers send cross-site without a preflight.
 */
export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return contentType.split(';')[0].trim().toLowerCase() === 'application/json';
}

/** Constant-time check of an `Authorization: Bearer <key>` header against the configured key. */
export function isValidApiKey(authorization: string | undefined, apiKey: string | undefined): boolean {
  if (!apiKey) return true;
  if (!authorization || authorization.slice(0, 7).toLowerCase() !== 'bearer ') return false;
  const presented = createHash('sha256').update(authorization.slice(7).trim()).digest();
  const expected = createHash('sha256').update(apiKey).digest();
  return timingSafeEqual(presented, expected);
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

function corsList(cors: McpOptions['cors']): string[] {
  if (!cors) return [];
  return (Array.isArray(cors) ? cors : [cors]).filter(Boolean);
}

/**
 * Validates the `Origin` header, as the MCP transport specification requires.
 * Absent Origin (non-browser client) is allowed; a present Origin must be listed in
 * `allowedOrigins` or `cors` (or `cors` must be `'*'`).
 */
export function isOriginAllowed(origin: string | undefined, options: GuardOptions): boolean {
  if (origin === undefined || origin === '') return true;
  const allowed = [...(options.allowedOrigins ?? []), ...corsList(options.cors)];
  if (allowed.includes('*')) return true;
  const normalized = normalizeOrigin(origin);
  return allowed.some((entry) => normalizeOrigin(entry) === normalized);
}

/** CORS response headers for an allowed request. Empty when `cors` is not configured. */
export function buildCorsHeaders(origin: string | undefined, options: GuardOptions): Record<string, string> {
  const list = corsList(options.cors);
  if (list.length === 0) return {};
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (list.includes('*')) {
    headers['Access-Control-Allow-Origin'] = '*';
    return headers;
  }
  // Access-Control-Allow-Origin accepts a single origin: echo the caller's when it is listed.
  headers['Vary'] = 'Origin';
  if (origin && list.some((entry) => normalizeOrigin(entry) === normalizeOrigin(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/** Request information used to authenticate an MCP caller. */
export interface McpAuthInput {
  method?: string;
  headers: McpHeaderSource;
  /** Client address (IP) reported by the framework. */
  clientId?: string;
  /** The framework's own request object, handed to the `authenticate` hook. */
  raw?: unknown;
}

/** Outcome of `authenticateMcpRequest()`. */
export type McpAuthResult =
  | { ok: true; principal?: unknown }
  | { ok: false; message: string };

/**
 * Authenticates an MCP caller (secure by default):
 * - `apiKey` set: `Authorization: Bearer <apiKey>` must match (constant time);
 * - `authenticate` set: the hook must return a truthy principal (a throw counts as a rejection);
 * - neither set: rejected unless `allowAnonymous: true`.
 * When both `apiKey` and `authenticate` are configured, both must pass.
 */
export async function authenticateMcpRequest(
  request: McpAuthInput,
  options: Pick<McpOptions, 'apiKey' | 'authenticate' | 'allowAnonymous'>,
): Promise<McpAuthResult> {
  const hasApiKey = Boolean(options.apiKey);
  const hook = typeof options.authenticate === 'function' ? options.authenticate : undefined;

  if (!hasApiKey && !hook) {
    return options.allowAnonymous === true
      ? { ok: true }
      : { ok: false, message: 'Unauthorized: MCP authentication is not configured' };
  }
  if (hasApiKey && !isValidApiKey(getHeader(request.headers, 'authorization'), options.apiKey)) {
    return { ok: false, message: 'Unauthorized: invalid or missing API key' };
  }
  if (!hook) return { ok: true };

  let principal: unknown;
  try {
    principal = await hook({
      method: (request.method ?? 'POST').toUpperCase(),
      headers: request.headers,
      header: (name: string) => getHeader(request.headers, name),
      clientId: request.clientId,
      raw: request.raw,
    });
  } catch {
    principal = undefined;
  }
  return principal ? { ok: true, principal } : { ok: false, message: 'Unauthorized' };
}

/**
 * Applies the checks shared by every HTTP adapter, in order:
 * Origin (403), CORS preflight (204), method (405), API key / authentication not configured (401),
 * Content-Type (415), `authenticate` hook (401). On success, `principal` holds the hook's result.
 */
export async function guardMcpHttpRequest(
  request: McpAuthInput,
  options: GuardOptions,
): Promise<McpHttpGuardResult> {
  const origin = getHeader(request.headers, 'origin');
  if (!isOriginAllowed(origin, options)) {
    return { ok: false, status: 403, body: mcpFailure(null, -32000, 'Forbidden: origin not allowed'), headers: {} };
  }

  const headers = buildCorsHeaders(origin, options);
  const method = (request.method ?? 'POST').toUpperCase();

  if (method === 'OPTIONS') {
    return { ok: false, status: 204, headers };
  }
  if (method !== 'POST') {
    return { ok: false, status: 405, body: mcpFailure(null, -32600, 'Method not allowed'), headers: { ...headers, Allow: 'POST' } };
  }
  // Cheap checks first: the API key, and an endpoint left without any authentication.
  const hook = typeof options.authenticate === 'function';
  if (options.apiKey && !isValidApiKey(getHeader(request.headers, 'authorization'), options.apiKey)) {
    return { ok: false, status: 401, body: mcpFailure(null, -32000, 'Unauthorized: invalid or missing API key'), headers };
  }
  if (!options.apiKey && !hook && options.allowAnonymous !== true) {
    return { ok: false, status: 401, body: mcpFailure(null, -32000, 'Unauthorized: MCP authentication is not configured'), headers };
  }
  if (!isJsonContentType(getHeader(request.headers, 'content-type'))) {
    return { ok: false, status: 415, body: mcpFailure(null, -32700, 'Content-Type must be application/json'), headers };
  }
  if (hook) {
    const auth = await authenticateMcpRequest(request, options);
    if (!auth.ok) {
      return { ok: false, status: 401, body: mcpFailure(null, -32000, auth.message), headers };
    }
    return { ok: true, status: 200, headers, principal: auth.principal };
  }
  return { ok: true, status: 200, headers };
}

/**
 * Builds the per-call context from the incoming request: the caller credentials to forward
 * (only when `forwardAuthorization` is enabled) and the client id used for rate limiting.
 */
export function buildMcpCallContext(
  headers: McpHeaderSource,
  clientId: string | undefined,
  options: Pick<McpOptions, 'apiKey' | 'forwardAuthorization'>,
  principal?: unknown,
): McpCallContext {
  const context: McpCallContext = { clientId: clientId || undefined };
  if (principal !== undefined) context.principal = principal;
  if (!options.forwardAuthorization) return context;

  const forwardHeaders: Record<string, string> = {};
  const authorization = getHeader(headers, 'authorization');
  // The MCP API key authenticates the MCP client, not the user: never pass it on.
  if (authorization && !(options.apiKey && isValidApiKey(authorization, options.apiKey))) {
    forwardHeaders['authorization'] = authorization;
  }
  const cookie = getHeader(headers, 'cookie');
  if (cookie) forwardHeaders['cookie'] = cookie;

  context.forwardHeaders = forwardHeaders;
  return context;
}
