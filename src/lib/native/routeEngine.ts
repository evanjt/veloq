/**
 * Shared native module loader for route-matcher-native.
 *
 * Lazy loads the native module to avoid bundler errors when the
 * native module is not available (e.g., in web or Expo Go).
 */

// Cached module reference
let _module: typeof import('route-matcher-native') | null = null;
let _loadAttempted = false;

/**
 * Get the full route-matcher-native module.
 * Returns null if module is not available.
 */
export function getNativeModule(): typeof import('route-matcher-native') | null {
  if (_loadAttempted) return _module;
  _loadAttempted = true;
  try {
    _module = require('route-matcher-native');
  } catch {
    _module = null;
  }
  return _module;
}

/**
 * Get the route engine from the native module.
 * Returns null if module is not available.
 */
export function getRouteEngine(): typeof import('route-matcher-native').routeEngine | null {
  const mod = getNativeModule();
  return mod?.routeEngine ?? null;
}
