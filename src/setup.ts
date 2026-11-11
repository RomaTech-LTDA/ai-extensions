import type { McpOptions, ResolvedMcpOptions } from './mcp/options';
import { assertMcpAuthConfigured, resolveMcpOptions } from './mcp/options';
import type { RagOptions } from './rag/options';
import { SwaggerDiscoveryProvider, type SwaggerDiscoveryOptions } from './discovery/swagger-discovery-provider';
import { McpToolRegistry } from './mcp/tool-registry';
import { McpToolExecutor } from './mcp/tool-executor';
import { McpRequestHandler } from './mcp/request-handler';
import { SlidingWindowRateLimiter } from './mcp/rate-limiter';
import { McpMetrics } from './mcp/metrics';
import { McpResourceRegistry } from './mcp/resources';
import { CircuitBreaker, type CircuitBreakerOptions } from './mcp/circuit-breaker';
import { McpAuditLog, type McpAuditLogOptions } from './mcp/audit-log';
import { createMcpMiddleware } from './mcp/middleware';
import { processMcpHttpRequest } from './mcp/http-pipeline';
import { registerFastifyMcpRoutes } from './adapters/fastify';
import { createKoaMcpMiddleware } from './adapters/koa';
import { LocalEmbeddingProvider } from './rag/local-embedding-provider';
import { SemanticIndexer } from './rag/semantic-indexer';
import { RagSearchService } from './rag/search-service';
import type { IEndpointDiscoveryProvider, IEmbeddingProvider } from './shared/models';
import type { ILogger } from './shared/logger';
import { ConsoleLogger } from './shared/logger';

/**
 * Configuration options for the full AI enablement setup.
 */
export interface AiOptions {
  /** MCP configuration. */
  mcp?: McpOptions;
  /** RAG configuration. */
  rag?: RagOptions;
  /** Base URL for internal HTTP calls when executing tools. Default: http://localhost:3000 */
  baseUrl?: string;
  /**
   * Swagger/OpenAPI discovery options.
   * Default: { specUrl: '{baseUrl}/api-docs.json' }
   */
  swagger?: SwaggerDiscoveryOptions;
  /** Custom discovery provider. Overrides Swagger discovery if provided. */
  discoveryProvider?: IEndpointDiscoveryProvider;
  /** Custom embedding provider. Default: LocalEmbeddingProvider */
  embeddingProvider?: IEmbeddingProvider;
  /** Custom logger. Default: ConsoleLogger */
  logger?: ILogger;
  /**
   * Circuit breaker for tool executions (opt-in): `true` for the defaults, or its options.
   * A tool whose calls keep failing (timeouts, network errors, HTTP 5xx) is refused with
   * `isError: true` until a trial call succeeds. Default: disabled
   */
  circuitBreaker?: boolean | CircuitBreakerOptions;
  /**
   * In-memory audit log of tool executions, returned as `auditLog`. Pass `false` to disable.
   * Arguments are not stored unless `includeArguments: true`. Default: enabled (10000 entries)
   */
  auditLog?: false | McpAuditLogOptions;
}

/**
 * Result of the AI setup containing references to services.
 */
export interface AiServices {
  /** MCP request handler for custom integrations. */
  mcpHandler: McpRequestHandler;
  /** MCP tool registry. */
  mcpRegistry: McpToolRegistry;
  /** MCP tool executor (register custom handlers here). */
  mcpExecutor: McpToolExecutor;
  /** RAG search service. */
  ragSearch: RagSearchService;
  /** MCP usage metrics. */
  metrics: McpMetrics;
  /** Audit log of tool executions (undefined when disabled with `auditLog: false`). */
  auditLog?: McpAuditLog;
  /** Circuit breaker of tool executions (undefined unless enabled with `circuitBreaker`). */
  circuitBreaker?: CircuitBreaker;
  /** Logger instance. */
  logger: ILogger;
}

/**
 * Any framework that supports middleware/route registration.
 * Works with Express, Fastify, Koa Router, Hono, and any framework with:
 * - `.use(middleware)` for middleware registration, OR
 * - `.post(path, handler)` for direct route registration
 */
type FrameworkApp = {
  use?: Function;
  post?: Function;
  get?: Function;
  register?: Function; // Fastify plugin registration
  [key: string]: any;
};

/**
 * Sets up AI enablement on any Node.js HTTP framework.
 *
 * Supported frameworks:
 * - **Express**: `useAi(app)` — registers as middleware via `app.use()`
 * - **Fastify**: `useAi(fastify)` — registers as plugin via `fastify.register()`
 * - **Koa**: `useAi(router)` — registers routes on the Koa router
 * - **Hono**: `useAi(app)` — registers routes via `app.post()`
 *
 * Works like the .NET version:
 * 1. Discovers ALL endpoints from Swagger/OpenAPI spec automatically
 * 2. Endpoints marked with `@AiTool()` become executable MCP tools
 * 3. Endpoints marked with `@AiHidden()` are excluded
 * 4. All other endpoints are ReadOnly (indexed in RAG for semantic search)
 * 5. Exposes MCP protocol at POST /mcp
 * 6. Built-in `rag_search` tool for semantic API documentation search
 *
 * @example
 * ```ts
 * // Express
 * const app = express();
 * useController(app, OrdersController);
 * useAi(app);
 *
 * // Fastify
 * const fastify = Fastify();
 * useController(fastify, OrdersController);
 * useAi(fastify);
 *
 * // Koa
 * const router = new Router();
 * useController(router, OrdersController);
 * useAi(router);
 *
 * // Hono
 * const app = new Hono();
 * useController(app, OrdersController);
 * useAi(app);
 * ```
 */
export function useAi(app: FrameworkApp, options?: AiOptions): AiServices {
  // Secure by default: refuse to expose an anonymous MCP endpoint by accident.
  assertMcpAuthConfigured(options?.mcp);
  const baseUrl = options?.baseUrl ?? 'http://localhost:3000';
  const mcpOptions: ResolvedMcpOptions = resolveMcpOptions(options?.mcp);
  const logger = options?.logger ?? new ConsoleLogger();
  const metrics = new McpMetrics();

  // Discovery
  const discoveryProvider = options?.discoveryProvider ?? new SwaggerDiscoveryProvider(
    options?.swagger ?? { specUrl: `${baseUrl}/api-docs.json` },
  );

  // MCP core services
  const registry = new McpToolRegistry(discoveryProvider);
  const executor = new McpToolExecutor(baseUrl, mcpOptions.toolTimeoutMs, { maxResponseBytes: mcpOptions.maxToolResponseBytes });
  const rateLimiter = new SlidingWindowRateLimiter();
  const handler = new McpRequestHandler(registry, executor, rateLimiter, mcpOptions);

  // RAG
  const embeddingProvider = options?.embeddingProvider ?? new LocalEmbeddingProvider();
  const indexer = new SemanticIndexer(embeddingProvider);
  const ragSearch = new RagSearchService(indexer, discoveryProvider, options?.rag);

  // Connect services
  handler.attachLogger(logger);
  handler.attachRagSearch(ragSearch);
  handler.attachMetrics(metrics);
  const auditLog = options?.auditLog === false ? undefined : new McpAuditLog(options?.auditLog ?? {});
  if (auditLog) handler.attachAuditLog(auditLog);
  const circuitBreaker = options?.circuitBreaker
    ? new CircuitBreaker(options.circuitBreaker === true ? undefined : options.circuitBreaker)
    : undefined;
  if (circuitBreaker) handler.attachCircuitBreaker(circuitBreaker);
  const resources = new McpResourceRegistry(discoveryProvider);
  handler.attachResources(resources);

  // Register MCP on the framework (auto-detect)
  registerMcpOnFramework(app, handler, mcpOptions);

  logger.info('AI enablement initialized', {
    route: mcpOptions.route,
    baseUrl,
    framework: detectFramework(app),
  });
  if (mcpOptions.allowAnonymous && !mcpOptions.apiKey && !mcpOptions.authenticate) {
    logger.warn('MCP endpoint is anonymous (mcp.allowAnonymous: true): anyone who can reach it can list and call tools.',
      { route: mcpOptions.route });
  }

  return {
    mcpHandler: handler,
    mcpRegistry: registry,
    mcpExecutor: executor,
    ragSearch,
    metrics,
    auditLog,
    circuitBreaker,
    logger,
  };
}

// ─── Framework Detection & Registration ──────────────────────────────────────────

function detectFramework(app: FrameworkApp): string {
  if (app.register && app.addHook) return 'fastify';
  if (app.use && app.context) return 'koa';
  if (app.use && app.listen) return 'express';
  if (app.fetch) return 'hono';
  return 'unknown';
}

function registerMcpOnFramework(app: FrameworkApp, handler: McpRequestHandler, options: ResolvedMcpOptions): void {
  const framework = detectFramework(app);

  switch (framework) {
    case 'fastify':
      registerFastifyMcpRoutes(app, handler, options);
      break;
    case 'koa':
      app.use!(createKoaMcpMiddleware(handler, options));
      break;
    case 'hono':
      registerHono(app, handler, options);
      break;
    case 'express':
    default:
      app.use!(createMcpMiddleware(handler, options));
      break;
  }
}

function registerHono(app: FrameworkApp, handler: McpRequestHandler, options: ResolvedMcpOptions): void {
  const route = options.route;

  // Health
  app.get!(`${route}/health`, (c: any) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  const answer = async (c: any, method: string) => {
    // Hono has no portable client address: every caller shares one rate-limit bucket. To rate-limit
    // per client, register the route yourself and call processMcpHttpRequest() with a clientId.
    const outcome = await processMcpHttpRequest(
      handler,
      options,
      { method, headers: c.req.raw.headers, raw: c },
      () => c.req.json(),
    );
    return outcome.body === undefined
      ? c.body(null, outcome.status, outcome.headers)
      : c.json(outcome.body, outcome.status, outcome.headers);
  };

  // CORS preflight (only answered when allowed by the Origin check)
  app.options?.(route, (c: any) => answer(c, 'OPTIONS'));
  app.post!(route, (c: any) => answer(c, 'POST'));
}
