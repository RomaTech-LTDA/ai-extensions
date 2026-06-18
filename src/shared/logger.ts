/**
 * Simple logger interface for structured logging.
 * Users can provide their own implementation (pino, winston, etc).
 */
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Default console-based logger.
 */
export class ConsoleLogger implements ILogger {
  constructor(private readonly _prefix: string = '@romatech/ai') {}

  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[${this._prefix}] ${message}`, context ?? '');
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    console.info(`[${this._prefix}] ${message}`, context ?? '');
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`[${this._prefix}] ${message}`, context ?? '');
  }

  error(message: string, context?: Record<string, unknown>): void {
    console.error(`[${this._prefix}] ${message}`, context ?? '');
  }
}

/** No-op logger for disabling all output. */
export class NullLogger implements ILogger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
