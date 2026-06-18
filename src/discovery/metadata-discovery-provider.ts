import { metadataRegistry, type RouteMetadata } from '../metadata/registry';
import type { AiEndpointDescriptor, IEndpointDiscoveryProvider } from '../shared/models';
import { AiExposureLevel } from '../shared/models';

/**
 * Discovers endpoints by reading from the metadata registry.
 * Routes annotated with aiTool(), aiHidden(), or aiReadOnly() will be picked up.
 */
export class MetadataDiscoveryProvider implements IEndpointDiscoveryProvider {
  async discoverEndpoints(): Promise<AiEndpointDescriptor[]> {
    const entries = metadataRegistry.getAll();
    const descriptors: AiEndpointDescriptor[] = [];

    for (const [key, metadata] of entries) {
      const [method, path] = key.split(':');
      if (!method || !path) continue;

      descriptors.push(this.toDescriptor(method, path, metadata));
    }

    return descriptors;
  }

  private toDescriptor(method: string, path: string, metadata: RouteMetadata): AiEndpointDescriptor {
    const exposureLevel = this.resolveExposure(metadata);
    const toolName = metadata.toolName ?? this.generateToolName(method, path);

    return {
      toolName,
      httpMethod: method.toUpperCase(),
      route: path,
      description: metadata.description,
      category: metadata.category,
      requiredRole: metadata.role,
      rateLimitPerMinute: metadata.rateLimit,
      contextPriority: metadata.contextPriority ?? 0,
      exposureLevel,
    };
  }

  private resolveExposure(metadata: RouteMetadata): AiExposureLevel {
    switch (metadata.type) {
      case 'hidden':
        return AiExposureLevel.Hidden;
      case 'tool':
        return AiExposureLevel.Executable;
      case 'readonly':
        return AiExposureLevel.ReadOnly;
      default:
        return AiExposureLevel.ReadOnly;
    }
  }

  private generateToolName(method: string, path: string): string {
    const cleanPath = path
      .replace(/\//g, '_')
      .replace(/[{}:]/g, '')
      .replace(/^_/, '')
      .replace(/_$/, '');
    return `${method.toLowerCase()}_${cleanPath}`.toLowerCase();
  }
}
