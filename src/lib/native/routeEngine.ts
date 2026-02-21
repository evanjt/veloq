/**
 * Shared native module loader for veloqrs.
 *
 * Lazy loads the native module to avoid bundler errors when the
 * native module is not available (e.g., in web or Expo Go).
 */

// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';

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

/**
 * Get the plain filesystem path for the routes SQLite database.
 * FileSystem.documentDirectory returns a file:// URI, but SQLite needs a plain path.
 */
export function getRouteDbPath(): string | null {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return null;
  const plainPath = docDir.startsWith('file://') ? docDir.slice(7) : docDir;
  return `${plainPath}routes.db`;
}
