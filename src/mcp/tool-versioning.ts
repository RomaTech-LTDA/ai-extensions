import type { ToolHandler } from './tool-executor';

/**
 * A versioned tool definition.
 */
export interface VersionedTool {
  /** Tool name (without version suffix). */
  name: string;
  /** Version string. */
  version: string;
  /** The handler for this version. */
  handler: ToolHandler;
  /** Whether this version is deprecated. */
  deprecated?: boolean;
  /** Description for this version. */
  description?: string;
}

/**
 * Manages multiple versions of the same tool.
 * Allows gradual migration between tool versions.
 *
 * @example
 * ```ts
 * const versions = new ToolVersionManager();
 *
 * versions.register({
 *     name: 'create_order',
 *     version: '1',
 *     handler: createOrderV1,
 *     deprecated: true,
 * });
 *
 * versions.register({
 *     name: 'create_order',
 *     version: '2',
 *     handler: createOrderV2,
 *     description: 'Creates order with new payment flow',
 * });
 *
 * // Get latest non-deprecated version
 * const handler = versions.getLatest('create_order');
 *
 * // Get specific version
 * const v1 = versions.get('create_order', '1');
 *
 * // List all versions
 * const all = versions.listVersions('create_order');
 * ```
 */
export class ToolVersionManager {
  private readonly _tools = new Map<string, VersionedTool[]>();

  /**
   * Registers a versioned tool.
   */
  register(tool: VersionedTool): void {
    const versions = this._tools.get(tool.name) ?? [];
    // Replace existing version if same
    const idx = versions.findIndex(t => t.version === tool.version);
    if (idx >= 0) {
      versions[idx] = tool;
    } else {
      versions.push(tool);
    }
    this._tools.set(tool.name, versions);
  }

  /**
   * Gets a specific version of a tool.
   */
  get(name: string, version: string): VersionedTool | undefined {
    return this._tools.get(name)?.find(t => t.version === version);
  }

  /**
   * Gets the latest non-deprecated version of a tool.
   */
  getLatest(name: string): VersionedTool | undefined {
    const versions = this._tools.get(name);
    if (!versions?.length) return undefined;
    // Prefer non-deprecated, pick last registered
    const active = versions.filter(t => !t.deprecated);
    return active.length > 0 ? active[active.length - 1] : versions[versions.length - 1];
  }

  /**
   * Lists all versions of a tool.
   */
  listVersions(name: string): VersionedTool[] {
    return this._tools.get(name) ?? [];
  }

  /**
   * Returns all tool names that have registered versions.
   */
  getToolNames(): string[] {
    return Array.from(this._tools.keys());
  }
}
