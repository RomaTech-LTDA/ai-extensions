import type { AiEndpointDescriptor, IEndpointDiscoveryProvider } from '../shared/models';
import { AiExposureLevel } from '../shared/models';
import { metadataRegistry } from '../metadata/registry';

/**
 * Discovers endpoints by fetching the application's Swagger/OpenAPI JSON spec.
 * Enriches results with metadata from the registry (aiTool, aiHidden, etc).
 *
 * @example
 * ```ts
 * const provider = new SwaggerDiscoveryProvider('http://localhost:3000/api-docs.json');
 * const endpoints = await provider.discoverEndpoints();
 * ```
 */
export class SwaggerDiscoveryProvider implements IEndpointDiscoveryProvider {
  constructor(private readonly _specUrl: string) {}

  async discoverEndpoints(): Promise<AiEndpointDescriptor[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(this._specUrl, { signal: controller.signal });
      if (!response.ok) {
        return [];
      }
      const spec = (await response.json()) as OpenApiSpec;
      return this.convertToDescriptors(spec);
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private convertToDescriptors(spec: OpenApiSpec): AiEndpointDescriptor[] {
    const descriptors: AiEndpointDescriptor[] = [];

    for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (['get', 'post', 'put', 'patch', 'delete'].indexOf(method) === -1) continue;

        const httpMethod = method.toUpperCase();
        const metadata = metadataRegistry.get(httpMethod, path);

        let exposureLevel = AiExposureLevel.ReadOnly;
        if (metadata?.type === 'hidden') exposureLevel = AiExposureLevel.Hidden;
        else if (metadata?.type === 'tool') exposureLevel = AiExposureLevel.Executable;

        if (exposureLevel === AiExposureLevel.Hidden) continue;

        const toolName = metadata?.toolName
          ?? (operation as any).operationId
          ?? this.generateToolName(httpMethod, path);

        descriptors.push({
          toolName,
          httpMethod,
          route: path,
          description: metadata?.description ?? (operation as any).summary ?? (operation as any).description,
          category: metadata?.category,
          requiredRole: metadata?.role,
          rateLimitPerMinute: metadata?.rateLimit,
          contextPriority: metadata?.contextPriority ?? 0,
          exposureLevel,
          operationId: (operation as any).operationId,
          inputSchema: this.extractInputSchema(operation as any),
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

  private extractInputSchema(operation: any): object | undefined {
    const schema: any = { type: 'object', properties: {}, required: [] };

    // Path/query parameters
    for (const param of operation.parameters ?? []) {
      schema.properties[param.name] = param.schema ?? { type: 'string' };
      if (param.required) schema.required.push(param.name);
    }

    // Request body
    const bodySchema = operation.requestBody?.content?.['application/json']?.schema;
    if (bodySchema?.properties) {
      Object.assign(schema.properties, bodySchema.properties);
      if (bodySchema.required) {
        schema.required.push(...bodySchema.required);
      }
    }

    return Object.keys(schema.properties).length > 0 ? schema : undefined;
  }
}

interface OpenApiSpec {
  paths?: Record<string, Record<string, unknown>>;
}
