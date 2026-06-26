/**
 * Circuit breaker states.
 */
export enum CircuitState {
  Closed = 'closed',       // Normal operation
  Open = 'open',           // Failing, reject all calls
  HalfOpen = 'half-open',  // Testing if recovery happened
}

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Time in ms to wait before trying again (half-open). Default: 30000 */
  resetTimeoutMs?: number;
  /** Number of successful calls in half-open to close circuit. Default: 2 */
  successThreshold?: number;
}

/**
 * Circuit breaker for tool execution.
 * Prevents cascading failures by temporarily disabling tools that fail repeatedly.
 *
 * @example
 * ```ts
 * const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000 });
 *
 * // Before executing a tool:
 * if (!breaker.canExecute('flaky_tool')) {
 *     return { error: 'Tool temporarily unavailable' };
 * }
 *
 * try {
 *     const result = await executeTool();
 *     breaker.recordSuccess('flaky_tool');
 *     return result;
 * } catch (err) {
 *     breaker.recordFailure('flaky_tool');
 *     throw err;
 * }
 * ```
 */
export class CircuitBreaker {
  private readonly _circuits = new Map<string, {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureAt: number;
  }>();
  private readonly _failureThreshold: number;
  private readonly _resetTimeoutMs: number;
  private readonly _successThreshold: number;

  constructor(options?: CircuitBreakerOptions) {
    this._failureThreshold = options?.failureThreshold ?? 5;
    this._resetTimeoutMs = options?.resetTimeoutMs ?? 30_000;
    this._successThreshold = options?.successThreshold ?? 2;
  }

  /**
   * Returns whether a tool can be executed (circuit is not open).
   */
  canExecute(toolName: string): boolean {
    const circuit = this._circuits.get(toolName);
    if (!circuit) return true;

    if (circuit.state === CircuitState.Closed) return true;

    if (circuit.state === CircuitState.Open) {
      // Check if enough time has passed to try again
      if (Date.now() - circuit.lastFailureAt > this._resetTimeoutMs) {
        circuit.state = CircuitState.HalfOpen;
        circuit.successes = 0;
        return true;
      }
      return false;
    }

    // HalfOpen — allow limited calls
    return true;
  }

  /**
   * Records a successful execution.
   */
  recordSuccess(toolName: string): void {
    const circuit = this._circuits.get(toolName);
    if (!circuit) return;

    if (circuit.state === CircuitState.HalfOpen) {
      circuit.successes++;
      if (circuit.successes >= this._successThreshold) {
        circuit.state = CircuitState.Closed;
        circuit.failures = 0;
      }
    } else {
      circuit.failures = 0;
    }
  }

  /**
   * Records a failed execution.
   */
  recordFailure(toolName: string): void {
    let circuit = this._circuits.get(toolName);
    if (!circuit) {
      circuit = { state: CircuitState.Closed, failures: 0, successes: 0, lastFailureAt: 0 };
      this._circuits.set(toolName, circuit);
    }

    circuit.failures++;
    circuit.lastFailureAt = Date.now();

    if (circuit.state === CircuitState.HalfOpen) {
      // Failed during recovery — re-open
      circuit.state = CircuitState.Open;
    } else if (circuit.failures >= this._failureThreshold) {
      circuit.state = CircuitState.Open;
    }
  }

  /**
   * Returns the current state of a tool's circuit.
   */
  getState(toolName: string): CircuitState {
    return this._circuits.get(toolName)?.state ?? CircuitState.Closed;
  }

  /**
   * Resets a circuit to closed state.
   */
  reset(toolName: string): void {
    this._circuits.delete(toolName);
  }
}
