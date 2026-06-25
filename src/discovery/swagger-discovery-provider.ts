import type { AiEndpointDescriptor, IEndpointDiscoveryProvider } from '../shared/models';
import { AiExposureLevel } from '../shared/models';
import { metadataRegistry } from '../metadata/registry';

/**
 * Options for the Swagger discovery provider.
 */
export interface SwaggerDiscoveryOptions {
  /** URL of the Swagger/OpenAPI JSON endpoint. Default: /api-docs.json */
  specUrl?: string;
  /** Whether to cache the spec in memory. Default: true */
  enableCaching?: boolean;
  /** Cache duration in milliseconds. Default: 300000 (5 minutes) */
  cacheDurationMs?: number;
}

/**
 * Discovers endpoints by fetching the application's Swagger/OpenAPI JSON spec.
 *
 * Works exactly like the .NET `SwaggerEndpointDiscoveryProvider`:
 * 1. Fetches the OpenAPI spec from the running application
 * 2. Converts each operation into an `AiEndpointDescriptor`
 * 3. Enriches with AI metadata from the registry (aiTool, aiHidden, etc)
 * 4. Without metadata: all endpoints default to ReadOnly (visible in RAG, not executable)
 * 5. With aiTool(): endpoint becomes Executable (MCP tool)
 * 6. With aiHidden(): endpoint is excluded entirely
 *
 * @example
 * ```ts
 * // Automatic: useAi will create this if @romatech/swagger is detected
 * const provider = new SwaggerDiscoveryProvider('http://localhost:3000/api-docs.json');
 * const endpoints = await provider.discoverEndpoints();
 * ```
 */
export class SwaggerDiscoveryProvider implements IEndpointDiscoveryProvider {
  private _cache: AiEndpointDescriptor[] | null = null;
  private _cacheTimestamp = 0;
  private readonly _specUrl: string;
  private readonly _enableCaching: boolean;
  private readonly _cacheDurationMs: number;

  constructor(specUrlOrOptions: string | SwaggerDiscoveryOptions) {
    if (typeof specUrlOrOptions === 'string') {
      this._specUrl = specUrlOrOptions;
      this._enableCaching = true;
      this._cacheDurationMs = 300_000;
    } else {
      this._specUrl = specUrlOrOptions.specUrl ?? '/api-docs.json';
      this._enableCaching = specUrlOrOptions.enableCaching ?? true;
      this._cacheDurationMs = specUrlOrOptions.cacheDurationMs ?? 300_000;
    }
  }

  async discoverEndpoints(): Promise<AiEndpointDescriptor[]> {
    // Return cached if valid
    if (this._enableCaching && this._cache && Date.now() - this._cacheTimestamp < this._cacheDurationMs) {
      return this._cache;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(this._specUrl, { signal: controller.signal });
      if (!response.ok) {
        // Fallback to metadata-only if Swagger isn't available yet
        return this.fallbackToMetadataOnly();
      }
      const spec = (await response.json()) as OpenApiSpec;
      const endpoints = this.convertToDescriptors(spec);

      if (this._enableCaching) {
        this._cache = endpoints;
        this._cacheTimestamp = Date.now();
      }

      return endpoints;
    } catch {
      // Swagger may not be ready yet (startup race), fall back to metadata
      return this.fallbackToMetadataOnly();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fallback when Swagger spec is not available.
   * Uses only the metadata registry (manually registered routes).
   */
  private fallbackToMetadataOnly(): AiEndpointDescriptor[] {
    const entries = metadataRegistry.getAll();
    const descriptors: AiEndpointDescriptor[] = [];

    for (const [key, metadata] of entries) {
      const [method, path] = key.split(':');
      if (!method || !path) continue;
      if (metadata.type === 'hidden') continue;

      descriptors.push({
        toolName: metadata.toolName ?? this.generateToolName(method, path),
        httpMethod: method.toUpperCase(),
        route: path,
        description: metadata.description,
        category: metadata.category,
        requiredRole: metadata.role,
        rateLimitPerMinute: metadata.rateLimit,
        contextPriority: metadata.contextPriority ?? 0,
        exposureLevel: metadata.type === 'tool' ? AiExposureLevel.Executable : AiExposureLevel.ReadOnly,
      });
    }

    return descriptors;
  }

  private convertToDescriptors(spec: OpenApiSpec): AiEndpointDescriptor[] {
    const descriptors: AiEndpointDescriptor[] = [];

    for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
      for (const [method, operationRaw] of Object.entries(pathItem)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        const operation = operationRaw as OpenApiOperation;

        const httpMethod = method.toUpperCase();

        // Check metadata registry for AI annotations
        const metadata = metadataRegistry.get(httpMethod, path);

        // Determine exposure level:
        // 1. metadata says hidden → skip
        // 2. metadata says tool → Executable
        // 3. x-ai-tool extension in spec → Executable
        // 4. x-ai-hidden extension in spec → skip
        // 5. default → ReadOnly (visible in RAG, not callable as MCP tool)
        let exposureLevel = AiExposureLevel.ReadOnly;

        if (metadata?.type === 'hidden') continue;
        if (operation['x-ai-hidden'] === true) continue;

        if (metadata?.type === 'tool') {
          exposureLevel = AiExposureLevel.Executable;
        } else if (operation['x-ai-tool'] === true) {
          exposureLevel = AiExposureLevel.Executable;
        }

        // Resolve tool name (priority: metadata > x-ai-tool-name > operationId > generated)
        const toolName = metadata?.toolName
          ?? (operation['x-ai-tool-name'] as string)
          ?? operation.operationId
          ?? this.generateToolName(httpMethod, path);

        // Resolve description
        const description = metadata?.description
          ?? (operation['x-ai-description'] as string)
          ?? operation.summary
          ?? operation.description;

        // Resolve category
        const category = metadata?.category
          ?? (operation['x-ai-category'] as string)
          ?? (operation.tags?.[0] as string);

        // Resolve rate limit
        const rateLimitPerMinute = metadata?.rateLimit
          ?? (operation['x-ai-rate-limit'] as number | undefined);

        // Resolve context priority
        const contextPriority = metadata?.contextPriority
          ?? (operation['x-ai-context-priority'] as number | undefined)
          ?? 0;

        // Resolve role
        const requiredRole = metadata?.role
          ?? (operation['x-ai-role'] as string | undefined);

        descriptors.push({
          toolName,
          httpMethod,
          route: path,
          description,
          category,
          requiredRole,
          rateLimitPerMinute,
          contextPriority,
          exposureLevel,
          operationId: operation.operationId,
          inputSchema: this.extractInputSchema(operation),
        });
      }
    }

    return descriptors;
  }

  private generateToolName(method: string, path: string): string {
    const cleanPath = path
      .replace(/\//g, '_')
      .replace(/[{}:]/g, '')
      .replace(/^_/, '')
      .replace(/_$/, '');
    return `${method.toLowerCase()}_${cleanPath}`.toLowerCase();
  }

  private extractInputSchema(operation: OpenApiOperation): object | undefined {
    const schema: any = { type: 'object', properties: {}, required: [] };

    // Path and query parameters
    for (const param of operation.parameters ?? []) {
      schema.properties[param.name] = param.schema ?? { type: 'string' };
      if (param.description && schema.properties[param.name]) {
        schema.properties[param.name].description = param.description;
      }
      if (param.required) schema.required.push(param.name);
    }

    // Request body
    const bodyContent = operation.requestBody?.content;
    const bodySchema = bodyContent?.['application/json']?.schema;
    if (bodySchema?.properties) {
      for (const [key, prop] of Object.entries(bodySchema.properties)) {
        schema.properties[key] = prop;
      }
      if (bodySchema.required) {
        schema.required.push(...bodySchema.required);
      }
    }

    if (schema.required.length === 0) delete schema.required;
    return Object.keys(schema.properties).length > 0 ? schema : undefined;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────────

interface OpenApiSpec {
  paths?: Record<string, Record<string, unknown>>;
  info?: { title?: string; version?: string };
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: any }>;
  };
  responses?: Record<string, unknown>;
  [key: string]: unknown; // for x-ai-* extensions
}

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: object;
}
