import type { McpOptions } from './mcp/options';
import { DEFAULT_MCP_OPTIONS } from './mcp/options';
import type { RagOptions } from './rag/options';
import { SwaggerDiscoveryProvider, type SwaggerDiscoveryOptions } from './discovery/swagger-discovery-provider';
import { McpToolRegistry } from './mcp/tool-registry';
import { McpToolExecutor } from './mcp/tool-executor';
import { McpRequestHandler } from './mcp/request-handler';
import { SlidingWindowRateLimiter } from './mcp/rate-limiter';
import { McpMetrics } from './mcp/metrics';
import { McpResourceRegistry } from './mcp/resources';
import { createMcpMiddleware } from './mcp/middleware';
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
  const baseUrl = options?.baseUrl ?? 'http://localhost:3000';
  const mcpOptions: Required<McpOptions> = { ...DEFAULT_MCP_OPTIONS, ...options?.mcp };
  const logger = options?.logger ?? new ConsoleLogger();
  const metrics = new McpMetrics();

  // Discovery
  const discoveryProvider = options?.discoveryProvider ?? new SwaggerDiscoveryProvider(
    options?.swagger ?? { specUrl: `${baseUrl}/api-docs.json` },
  );

  // MCP core services
  const registry = new McpToolRegistry(discoveryProvider);
  const executor = new McpToolExecutor(baseUrl, mcpOptions.toolTimeoutMs);
  const rateLimiter = new SlidingWindowRateLimiter();
  const handler = new McpRequestHandler(registry, executor, rateLimiter, mcpOptions);

  // RAG
  const embeddingProvider = options?.embeddingProvider ?? new LocalEmbeddingProvider();
  const indexer = new SemanticIndexer(embeddingProvider);
  const ragSearch = new RagSearchService(indexer, discoveryProvider, options?.rag);

  // Connect services
  handler.attachRagSearch(ragSearch);
  handler.attachMetrics(metrics);
  const resources = new McpResourceRegistry(discoveryProvider);
  handler.attachResources(resources);

  // Register MCP on the framework (auto-detect)
  registerMcpOnFramework(app, handler, mcpOptions);

  logger.info('AI enablement initialized', {
    route: mcpOptions.route,
    baseUrl,
    framework: detectFramework(app),
  });

  return {
    mcpHandler: handler,
    mcpRegistry: registry,
    mcpExecutor: executor,
    ragSearch,
    metrics,
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

function registerMcpOnFramework(app: FrameworkApp, handler: McpRequestHandler, options: Required<McpOptions>): void {
  const framework = detectFramework(app);

  switch (framework) {
    case 'fastify':
      registerFastify(app, handler, options);
      break;
    case 'koa':
      registerKoa(app, handler, options);
      break;
    case 'hono':
      registerHono(app, handler, options);
      break;
    case 'express':
    default:
      registerExpress(app, handler, options);
      break;
  }
}

function registerExpress(app: FrameworkApp, handler: McpRequestHandler, options: Required<McpOptions>): void {
  const middleware = createMcpMiddleware(handler, options);
  app.use!(middleware);
}

function registerFastify(app: FrameworkApp, handler: McpRequestHandler, options: Required<McpOptions>): void {
  const route = options.route;

  // Health
  app.get!(`${route}/health`, async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // MCP endpoint
  app.post!(route, async (request: any, reply: any) => {
    const body = request.body;
    if (!body || !body.method) {
      return reply.status(400).send({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid request' } });
    }

    // Auth check
    if (options.apiKey) {
      const auth = request.headers['authorization'] ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== options.apiKey) {
        return reply.status(401).send({ jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized' } });
      }
    }

    const response = await handler.handle(body);
    return response;
  });
}

function registerKoa(app: FrameworkApp, handler: McpRequestHandler, options: Required<McpOptions>): void {
  const route = options.route;

  // Register as Koa middleware
  const koaMiddleware = async (ctx: any, next: () => Promise<void>) => {
    if (ctx.path === `${route}/health` && ctx.method === 'GET') {
      ctx.body = { status: 'ok', timestamp: new Date().toISOString() };
      return;
    }

    if (ctx.path !== route || ctx.method !== 'POST') {
      return next();
    }

    if (options.apiKey) {
      const auth = ctx.headers['authorization'] ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== options.apiKey) {
        ctx.status = 401;
        ctx.body = { jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized' } };
        return;
      }
    }

    const body = ctx.request.body;
    if (!body || !body.method) {
      ctx.status = 400;
      ctx.body = { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid request' } };
      return;
    }

    ctx.body = await handler.handle(body);
  };

  app.use!(koaMiddleware);
}

function registerHono(app: FrameworkApp, handler: McpRequestHandler, options: Required<McpOptions>): void {
  const route = options.route;

  // Health
  app.get!(`${route}/health`, (c: any) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // MCP endpoint
  app.post!(route, async (c: any) => {
    if (options.apiKey) {
      const auth = c.req.header('authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== options.apiKey) {
        return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized' } }, 401);
      }
    }

    const body = await c.req.json();
    if (!body || !body.method) {
      return c.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid request' } }, 400);
    }

    const response = await handler.handle(body);
    return c.json(response);
  });
}
