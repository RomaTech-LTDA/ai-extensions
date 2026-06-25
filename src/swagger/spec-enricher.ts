import { metadataRegistry } from '../metadata/registry';

/**
 * Enriches an OpenAPI spec object with x-ai-* extensions based on the metadata registry.
 * This is the Node.js equivalent of the .NET `AiMetadataOperationFilter`.
 *
 * Call this AFTER generating the spec with @romatech/swagger to inject AI metadata
 * into the spec document. External tools reading the spec will see the x-ai-* extensions.
 *
 * @example
 * ```ts
 * import { enrichSpecWithAiMetadata } from '@romatech/ai-extensions';
 *
 * // If you have access to the raw spec object:
 * const spec = generateSpec(routes);
 * enrichSpecWithAiMetadata(spec);
 * ```
 */
export function enrichSpecWithAiMetadata(spec: any): void {
  if (!spec?.paths) return;

  for (const [path, pathItem] of Object.entries(spec.paths as Record<string, any>)) {
    for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;

      const httpMethod = method.toUpperCase();
      const metadata = metadataRegistry.get(httpMethod, path);
      if (!metadata) continue;

      // Ensure extensions object exists
      if (!operation.extensions) operation.extensions = {};

      switch (metadata.type) {
        case 'hidden':
          operation['x-ai-hidden'] = true;
          break;
        case 'tool':
          operation['x-ai-tool'] = true;
          if (metadata.toolName) operation['x-ai-tool-name'] = metadata.toolName;
          break;
      }

      if (metadata.description) operation['x-ai-description'] = metadata.description;
      if (metadata.category) operation['x-ai-category'] = metadata.category;
      if (metadata.role) operation['x-ai-role'] = metadata.role;
      if (metadata.rateLimit) operation['x-ai-rate-limit'] = metadata.rateLimit;
      if (metadata.contextPriority) operation['x-ai-context-priority'] = metadata.contextPriority;
    }
  }
}

/**
 * Express middleware that intercepts the Swagger JSON response and enriches it
 * with x-ai-* extensions. Place this AFTER useSwagger() but BEFORE useAi().
 *
 * This makes the metadata visible to any external tool reading the spec,
 * exactly like the .NET AiMetadataOperationFilter.
 *
 * @param specPath - The path where the spec is served. Default: /api-docs.json
 *
 * @example
 * ```ts
 * import { useSwagger } from '@romatech/swagger';
 * import { useAiSwaggerEnricher, useAi } from '@romatech/ai-extensions';
 *
 * useSwagger(app);
 * useAiSwaggerEnricher(app); // injects x-ai-* into the spec
 * useAi(app);
 * ```
 */
export function useAiSwaggerEnricher(
  app: any,
  specPath = '/api-docs.json',
): void {
  // Intercept the spec endpoint response to inject x-ai-* extensions
  const originalUse = app.get.bind(app);

  // Override the spec endpoint to enrich the response
  app.get(specPath, (req: any, res: any, next: any) => {
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      if (body && body.paths) {
        enrichSpecWithAiMetadata(body);
      }
      return originalJson(body);
    };
    next();
  });
}
