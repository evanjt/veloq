/**
 * Shared native module loader for veloqrs.
 *
 * Lazy loads the native module to avoid bundler errors when the
 * native module is not available (e.g., in web or Expo Go).
 */

// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';

let _module: typeof import('veloqrs') | null = null;
let _loadAttempted = false;

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

export function getEngine(): typeof import('veloqrs').engine | null {
  const mod = getNativeModule();
  return mod?.engine ?? null;
}

/**
 * Whether the engine is open, not merely whether a handle exists.
 *
 * `getEngine` hands back a singleton created on the first require, so a
 * null check there answers "did the native module load", never "can it answer
 * a question". Before `initWithPath` every read returns its empty default, so
 * a caller that branches on the handle reads those defaults as facts.
 */
export function isEngineReady(): boolean {
  return getEngine()?.ready ?? false;
}

// The configuration the detector is validated at, generated from
// `SectionConfig::default()` so the two cannot drift apart.
export { UNIFIED_CONFIG } from './unifiedConfig.generated';

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
