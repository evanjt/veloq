/**
 * Debug logging utilities with __DEV__ guards.
 * In production builds, all logging is no-op.
 */

type LogLevel = 'log' | 'warn' | 'error';

// No-op function for production
const noop = (): void => {};

// Create a logger function that respects __DEV__
function createLogger(level: LogLevel) {
  if (!__DEV__) {
    return noop;
  }

  return (...args: unknown[]): void => {
    console[level](...args);
  };
}

// Create a prefixed logger
function createPrefixedLogger(prefix: string, level: LogLevel) {
  if (!__DEV__) {
    return noop;
  }

  return (...args: unknown[]): void => {
    console[level](`[${prefix}]`, ...args);
  };
}

/**
 * Debug logging - only runs in development
 */
export const debug = {
  log: createLogger('log'),
  warn: createLogger('warn'),
  error: createLogger('error'),

  /**
   * Create a namespaced logger for a specific module
   * @example
   * const log = debug.create('RouteMatching');
   * log.log('Processing activity'); // [RouteMatching] Processing activity
   */
  create: (prefix: string) => ({
    log: createPrefixedLogger(prefix, 'log'),
    warn: createPrefixedLogger(prefix, 'warn'),
    error: createPrefixedLogger(prefix, 'error'),
  }),
};
