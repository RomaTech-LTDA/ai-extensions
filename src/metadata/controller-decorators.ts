import 'reflect-metadata';
import type { Request, Response, NextFunction } from 'express';
import { metadataRegistry } from './registry';

// ─── Route Decorators ────────────────────────────────────────────────────────────

/**
 * Marks a class as a controller with a base path prefix.
 *
 * @example
 * ```ts
 * @Controller('/api/orders')
 * class OrdersController { ... }
 * ```
 */
export function Controller(basePath: string): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('controller:basePath', basePath, target);
  };
}

/**
 * Registers a method as a GET route handler.
 */
export function Get(path = '/'): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata('route:method', 'GET', target, propertyKey);
    Reflect.defineMetadata('route:path', path, target, propertyKey);
    registerRouteMethod(target, propertyKey);
  };
}

/**
 * Registers a method as a POST route handler.
 */
export function Post(path = '/'): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata('route:method', 'POST', target, propertyKey);
    Reflect.defineMetadata('route:path', path, target, propertyKey);
    registerRouteMethod(target, propertyKey);
  };
}

/**
 * Registers a method as a PUT route handler.
 */
export function Put(path = '/'): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata('route:method', 'PUT', target, propertyKey);
    Reflect.defineMetadata('route:path', path, target, propertyKey);
    registerRouteMethod(target, propertyKey);
  };
}

/**
 * Registers a method as a PATCH route handler.
 */
export function Patch(path = '/'): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata('route:method', 'PATCH', target, propertyKey);
    Reflect.defineMetadata('route:path', path, target, propertyKey);
    registerRouteMethod(target, propertyKey);
  };
}

/**
 * Registers a method as a DELETE route handler.
 */
export function Delete(path = '/'): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata('route:method', 'DELETE', target, propertyKey);
    Reflect.defineMetadata('route:path', path, target, propertyKey);
    registerRouteMethod(target, propertyKey);
  };
}

// ─── Internal: track which methods have route decorators ─────────────────────────

function registerRouteMethod(target: Object, propertyKey: string | symbol): void {
  const methods: (string | symbol)[] = Reflect.getMetadata('controller:methods', target) ?? [];
  if (!methods.includes(propertyKey)) {
    methods.push(propertyKey);
    Reflect.defineMetadata('controller:methods', methods, target);
  }
}

// ─── useController: registers routes + AI metadata in one call ───────────────────

/**
 * Any framework that has .get(), .post(), .put(), .patch(), .delete() methods.
 * Works with Express, Fastify, Hono, and Koa Router.
 */
type RoutableApp = {
  get: (path: string, ...handlers: Function[]) => any;
  post: (path: string, ...handlers: Function[]) => any;
  put: (path: string, ...handlers: Function[]) => any;
  patch: (path: string, ...handlers: Function[]) => any;
  delete: (path: string, ...handlers: Function[]) => any;
};

/**
 * Registers a decorated controller on any framework (Express, Fastify, Koa Router, Hono).
 * Reads `@Controller`, `@Get/@Post/@Put/@Delete`, and AI decorators
 * to register both routes and AI metadata automatically.
 *
 * Works with any framework that has `.get(path, handler)`, `.post(path, handler)`, etc.
 *
 * @example
 * ```ts
 * // Express
 * import express from 'express';
 * const app = express();
 * useController(app, OrdersController);
 *
 * // Fastify
 * import Fastify from 'fastify';
 * const fastify = Fastify();
 * useController(fastify, OrdersController);
 *
 * // Koa
 * import Router from '@koa/router';
 * const router = new Router();
 * useController(router, OrdersController);
 *
 * // Hono
 * import { Hono } from 'hono';
 * const app = new Hono();
 * useController(app, OrdersController);
 * ```
 */
export function useController(app: RoutableApp, controller: Function): void {
  const basePath: string = Reflect.getMetadata('controller:basePath', controller) ?? '';
  const methods: (string | symbol)[] = Reflect.getMetadata('controller:methods', controller) ?? [];

  for (const methodName of methods) {
    const httpMethod: string | undefined = Reflect.getMetadata('route:method', controller, methodName);
    const routePath: string | undefined = Reflect.getMetadata('route:path', controller, methodName);

    if (!httpMethod || routePath === undefined) continue;

    // Build full path
    const fullPath = normalizePath(`${basePath}${routePath}`);

    // Get the handler function
    const handler = (controller as any)[methodName as string];
    if (typeof handler !== 'function') continue;

    // Register route on the Express app
    const expressMethod = httpMethod.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    (app as any)[expressMethod](fullPath, handler);

    // Register AI metadata
    const aiType = Reflect.getMetadata('ai:type', controller, methodName) as string | undefined;
    const toolName = Reflect.getMetadata('ai:toolName', controller, methodName) as string | undefined;
    const description = Reflect.getMetadata('ai:description', controller, methodName) as string | undefined;
    const category = Reflect.getMetadata('ai:category', controller, methodName) as string | undefined;
    const role = Reflect.getMetadata('ai:role', controller, methodName) as string | undefined;
    const rateLimit = Reflect.getMetadata('ai:rateLimit', controller, methodName) as number | undefined;
    const contextPriority = Reflect.getMetadata('ai:contextPriority', controller, methodName) as number | undefined;

    metadataRegistry.set(httpMethod, fullPath, {
      type: (aiType as 'tool' | 'hidden' | 'readonly') ?? 'readonly',
      toolName,
      description,
      category,
      role,
      rateLimit,
      contextPriority,
    });
  }
}

function normalizePath(path: string): string {
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}
