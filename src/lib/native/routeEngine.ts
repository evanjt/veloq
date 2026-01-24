/**
 * Shared native module loader for veloqrs.
 *
 * Lazy loads the native module to avoid bundler errors when the
 * native module is not available (e.g., in web or Expo Go).
 */

// Cached module reference
let _module: typeof import('veloqrs') | null = null;
let _loadAttempted = false;

/**
 * Get the full veloqrs module.
 * Returns null if module is not available.
 */
export function getNativeModule(): typeof import('veloqrs') | null {
  if (_loadAttempted) return _module;
  _loadAttempted = true;
  try {
    _module = require('veloqrs');
  } catch {
    _module = null;
  }
  return _module;
}

/**
 * Get the route engine from the native module.
 * Returns null if module is not available.
 */
export function getRouteEngine(): typeof import('veloqrs').routeEngine | null {
  const mod = getNativeModule();
  return mod?.routeEngine ?? null;
}
