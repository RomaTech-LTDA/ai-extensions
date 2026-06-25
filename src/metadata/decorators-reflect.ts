import 'reflect-metadata';
import { metadataRegistry } from './registry';
import type { RouteMetadata } from './registry';

/**
 * TypeScript method decorators for AI metadata — identical API to .NET attributes.
 * Requires `reflect-metadata` and `experimentalDecorators: true` in tsconfig.
 *
 * @example
 * ```ts
 * import 'reflect-metadata';
 * import { AiTool, AiHidden, AiDescription, AiCategory } from '@romatech/ai-extensions';
 *
 * class OrdersController {
 *     @AiTool('create_order')
 *     @AiDescription('Creates a new customer order')
 *     @AiCategory('Orders')
 *     @AiRateLimit(10)
 *     static create(req, res) { ... }
 *
 *     @AiHidden()
 *     static delete(req, res) { ... }
 * }
 *
 * // Register controller routes (call after defining the class)
 * registerController(OrdersController, {
 *     create: { method: 'POST', path: '/api/orders' },
 *     delete: { method: 'DELETE', path: '/api/orders/:id' },
 * });
 * ```
 */

// ─── Decorator: @AiTool ──────────────────────────────────────────────────────────

/**
 * Marks a method as an executable MCP tool.
 * Equivalent to .NET's [AiTool("tool_name")]
 *
 * @param name - Custom tool name. If omitted, inferred from method name.
 */
export function AiTool(name?: string): MethodDecorator {
  return (target, propertyKey, _descriptor) => {
    Reflect.defineMetadata('ai:type', 'tool', target, propertyKey);
    if (name) {
      Reflect.defineMetadata('ai:toolName', name, target, propertyKey);
    }
  };
}

// ─── Decorator: @AiHidden ────────────────────────────────────────────────────────

/**
 * Marks a method as hidden from all AI systems.
 * Equivalent to .NET's [AiHidden]
 */
export function AiHidden(): MethodDecorator {
  return (target, propertyKey, _descriptor) => {
    Reflect.defineMetadata('ai:type', 'hidden', target, propertyKey);
  };
}

// ─── Decorator: @AiDescription ───────────────────────────────────────────────────

/**
 * Sets the AI-facing description for a method.
 * Equivalent to .NET's [AiDescription("...")]
 */
export function AiDescription(description: string): MethodDecorator {
  return (target, propertyKey, _descriptor) => {
    Reflect.defineMetadata('ai:description', description, target, propertyKey);
  };
}

// ─── Decorator: @AiCategory ──────────────────────────────────────────────────────

/**
 * Sets the category grouping for semantic organization.
 * Equivalent to .NET's [AiCategory("...")]
 */
export function AiCategory(category: string): MethodDecorator {
  return (target, propertyKey, _descriptor) => {
    Reflect.defineMetadata('ai:category', category, target, propertyKey);
  };
}

// ─── Decorator: @AiRole ──────────────────────────────────────────────────────────

/**
 * Sets the required role for executing this tool.
 * Equivalent to .NET's [AiRole("...")]
 */
export function AiRole(role: string): MethodDecorator {
  return (target, propertyKey, _descriptor) => {
    Reflect.defineMetadata('ai:role', role, target, propertyKey);
  };
}

// ─── Decorator: @AiRateLimit ─────────────────────────────────────────────────────

/**
 * Sets the rate limit (requests per minute) for this tool.
 * Equivalent to .NET's [AiRateLimit(n)]
 */
export function AiRateLimit(requestsPerMinute: number): MethodDecorator {
  return (target, propertyKey, _descriptor) => {
    Reflect.defineMetadata('ai:rateLimit', requestsPerMinute, target, propertyKey);
  };
}

// ─── Decorator: @AiContextPriority ───────────────────────────────────────────────

/**
 * Sets the RAG context priority (higher = more relevant in search).
 * Equivalent to .NET's [AiContextPriority(n)]
 */
export function AiContextPriority(priority: number): MethodDecorator {
  return (target, propertyKey, _descriptor) => {
    Reflect.defineMetadata('ai:contextPriority', priority, target, propertyKey);
  };
}

// ─── Route Mapping ───────────────────────────────────────────────────────────────

/** Route definition for a controller method. */
export interface RouteMapping {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
}

/**
 * Reads AI metadata from a controller class decorated with @AiTool, @AiHidden, etc.
 * and registers it in the metadata registry.
 *
 * Call this AFTER defining the class and its decorators.
 *
 * @param controller - The controller class (not an instance)
 * @param routes - Map of method name → route definition
 *
 * @example
 * ```ts
 * class UsersController {
 *     @AiTool('create_user')
 *     @AiDescription('Creates a user')
 *     @AiCategory('Users')
 *     static create(req, res) { ... }
 *
 *     @AiHidden()
 *     static delete(req, res) { ... }
 *
 *     static getAll(req, res) { ... } // no decorator → ReadOnly
 * }
 *
 * registerController(UsersController, {
 *     create:  { method: 'POST', path: '/users' },
 *     delete:  { method: 'DELETE', path: '/users/:id' },
 *     getAll:  { method: 'GET', path: '/users' },
 * });
 * ```
 */
export function registerController(
  controller: Function,
  routes: Record<string, RouteMapping>,
): void {
  for (const [methodName, route] of Object.entries(routes)) {
    const metadata = resolveMethodMetadata(controller, methodName);
    metadataRegistry.set(route.method, route.path, metadata);
  }
}

/**
 * Resolves AI metadata from decorators on a specific method.
 */
function resolveMethodMetadata(controller: Function, methodName: string): RouteMetadata {
  const target = controller; // static methods store metadata on the constructor

  const type = Reflect.getMetadata('ai:type', target, methodName) as string | undefined;
  const toolName = Reflect.getMetadata('ai:toolName', target, methodName) as string | undefined;
  const description = Reflect.getMetadata('ai:description', target, methodName) as string | undefined;
  const category = Reflect.getMetadata('ai:category', target, methodName) as string | undefined;
  const role = Reflect.getMetadata('ai:role', target, methodName) as string | undefined;
  const rateLimit = Reflect.getMetadata('ai:rateLimit', target, methodName) as number | undefined;
  const contextPriority = Reflect.getMetadata('ai:contextPriority', target, methodName) as number | undefined;

  return {
    type: (type as 'tool' | 'hidden' | 'readonly') ?? 'readonly',
    toolName,
    description,
    category,
    role,
    rateLimit,
    contextPriority,
  };
}
