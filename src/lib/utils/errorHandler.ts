/**
 * @fileoverview Standardized error handling utilities
 *
 * Provides consistent error handling patterns across the application.
 * Replaces mixed error handling approaches with a unified strategy.
 *
 * **Error Handling Levels:**
 * - **Critical**: Errors that should be thrown and handled by UI
 * - **Warning**: Errors that should be logged but don't block flow
 * - **Silent**: Errors that can be safely ignored
 *
 * **Usage:**
 * ```ts
 * // Critical - throw and show to user
 * const data = await handleAsyncError(
 *   fetchData(),
 *   'FetchUser',
 *   { level: 'critical' }
 * );
 *
 * // Warning - log but don't throw
 * await handleAsyncError(
 *   trackEvent(),
 *   'Analytics',
 *   { level: 'warning', fallback: null }
 * );
 *
 * // Silent - ignore completely
 * handleAsyncError(
 *   prefetchData(),
 *   'Prefetch',
 *   { level: 'silent' }
 * );
 * ```
 */

export type ErrorLevel = 'critical' | 'warning' | 'silent';

export interface ErrorHandlerOptions<T> {
  /** Error handling level */
  level?: ErrorLevel;
  /** Fallback value to return on error (warning/silent only) */
  fallback?: T;
  /** Custom error message prefix */
  context?: string;
  /** Whether to log to console (default: true) */
  log?: boolean;
}

/**
 * Standardized async error handler.
 *
 * Provides consistent error handling across the application with configurable
 * severity levels and fallback values.
 *
 * @param promise - Promise to handle
 * @param context - Context description for error messages
 * @param options - Error handling options
 * @returns Promise result or fallback value
 *
 * @example
 * ```ts
 * // Critical error - will throw
 * const user = await handleAsyncError(
 *   api.fetchUser(),
 *   'LoadUserProfile',
 *   { level: 'critical' }
 * );
 *
 * // Warning with fallback - won't throw
 * const settings = await handleAsyncError(
 *   loadSettings(),
 *   'LoadSettings',
 *   { level: 'warning', fallback: defaultSettings }
 * );
 * ```
 */
export async function handleAsyncError<T>(
  promise: Promise<T>,
  context: string,
  options: ErrorHandlerOptions<T> = {}
): Promise<T> {
  const { level = 'critical', fallback, log = true } = options;

  try {
    return await promise;
  } catch (error) {
    if (!log) {
      // Silent mode - don't log
      if (level === 'silent') {
        return fallback as T;
      }
    }

    // Log error based on level
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorPrefix = options.context ? `[${options.context}]` : `[${context}]`;

    switch (level) {
      case 'critical':
        console.error(`${errorPrefix} Critical error:`, errorMessage);
        console.error(error);
        // Re-throw for component to handle
        throw error;
      case 'warning':
        console.warn(`${errorPrefix} Warning (using fallback):`, errorMessage);
        // Return fallback instead of throwing
        return fallback as T;
      case 'silent':
        // Silently return fallback
        return fallback as T;
    }
  }
}

/**
 * Standardized sync error handler.
 *
 * Same as handleAsyncError but for synchronous code.
 *
 * @param fn - Function to execute
 * @param context - Context description for error messages
 * @param options - Error handling options
 * @returns Function result or fallback value
 *
 * @example
 * ```ts
 * const parsed = handleErrorSync(
 *   () => JSON.parse(data),
 *   'ParseConfig',
 *   { level: 'warning', fallback: {} }
 * );
 * ```
 */
export function handleErrorSync<T>(
  fn: () => T,
  context: string,
  options: ErrorHandlerOptions<T> = {}
): T {
  const { level = 'critical', fallback, log = true } = options;

  try {
    return fn();
  } catch (error) {
    if (!log) {
      if (level === 'silent') {
        return fallback as T;
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorPrefix = options.context ? `[${options.context}]` : `[${context}]`;

    switch (level) {
      case 'critical':
        console.error(`${errorPrefix} Critical error:`, errorMessage);
        console.error(error);
        throw error;
      case 'warning':
        console.warn(`${errorPrefix} Warning (using fallback):`, errorMessage);
        return fallback as T;
      case 'silent':
        return fallback as T;
    }
  }
}

/**
 * Create a safe version of an async function that never throws.
 *
 * Wraps any async function to return a result tuple [error, data]
 * instead of throwing. Useful for fire-and-forget patterns.
 *
 * @param fn - Async function to wrap
 * @returns Safe function that returns [error, data] tuple
 *
 * @example
 * ```ts
 * const safeFetch = safeAsync(fetchData);
 *
 * // Usage
 * const [error, data] = await safeFetch(id);
 * if (error) {
 *   console.error('Failed:', error);
 * } else {
 *   console.log('Got:', data);
 * }
 * ```
 */
export function safeAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T
): (...args: Parameters<T>) => Promise<[Error | null, Awaited<ReturnType<T>>]> {
  return async (...args: Parameters<T>) => {
    try {
      const data = await fn(...args);
      return [null, data];
    } catch (error) {
      return [error as Error, null as Awaited<ReturnType<T>>];
    }
  };
}

/**
 * Create a safe version of a sync function that never throws.
 *
 * @param fn - Function to wrap
 * @returns Safe function that returns [error, data] tuple
 *
 * @example
 * ```ts
 * const safeParse = safeSync(JSON.parse);
 *
 * const [error, data] = safeParse(jsonString);
 * if (error) {
 *   return defaultValue;
 * }
 * return data;
 * ```
 */
export function safeSync<T extends (...args: any[]) => any>(
  fn: T
): (...args: Parameters<T>) => [Error | null, ReturnType<T>] {
  return (...args: Parameters<T>) => {
    try {
      const data = fn(...args);
      return [null, data];
    } catch (error) {
      return [error as Error, null as ReturnType<T>];
    }
  };
}
