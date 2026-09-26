/**
 * Shared native module loader for veloqrs.
 *
 * Lazy loads the native module to avoid bundler errors when the
 * native module is not available (e.g., in web or Expo Go).
 */

// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';

import { appGroupPath } from '@/shared/native/appGroup';
import {
  migrateRouteDb,
  routeDbDirectory,
  type RouteDbFileSystem,
} from '@/shared/storage/routeDbLocation';

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
 * Where the database is opened from. Null until `resolveRouteDbPath` has run,
 * which is once, at launch, before anything opens the engine.
 */
let routeDbDir: string | null = null;

/** The documents directory as a plain path, since SQLite is given no scheme. */
function documentsDirectory(): string | null {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return null;
  return docDir.startsWith('file://') ? docDir.slice(7) : docDir;
}

/**
 * Get the plain filesystem path for the routes SQLite database.
 * FileSystem.documentDirectory returns a file:// URI, but SQLite needs a plain path.
 *
 * Documents until `resolveRouteDbPath` says otherwise, which is where every
 * released build put it. A caller that runs before the migration therefore
 * reads the old location, which is the one that still holds the data.
 */
export function getRouteDbPath(): string | null {
  const dir = routeDbDir ?? documentsDirectory();
  if (!dir) return null;
  return `${dir}routes.db`;
}

/** `expo-file-system` speaks URIs, `migrateRouteDb` speaks plain paths. */
const routeDbFileSystem: RouteDbFileSystem = {
  async size(path) {
    const info = await FileSystem.getInfoAsync(`file://${path}`);
    return info.exists && 'size' in info ? (info.size ?? 0) : null;
  },
  copy(from, to) {
    return FileSystem.copyAsync({ from: `file://${from}`, to: `file://${to}` });
  },
  remove(path) {
    return FileSystem.deleteAsync(`file://${path}`, { idempotent: true });
  },
};

/**
 * Settle where the database lives, moving it into the App Group container on
 * the first launch that can reach one, and answer the path to open.
 *
 * Call this before the engine is opened and never while it is: the move is
 * only a consistent snapshot because nothing is writing during it.
 */
export async function resolveRouteDbPath(): Promise<string | null> {
  const docDir = documentsDirectory();
  if (!docDir) return null;
  const target = routeDbDirectory(appGroupPath(), docDir);
  try {
    routeDbDir = await migrateRouteDb(docDir, target, routeDbFileSystem);
  } catch {
    routeDbDir = docDir;
  }
  return getRouteDbPath();
}
