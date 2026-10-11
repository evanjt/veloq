/**
 * Per-activity camera override store for 3D terrain previews.
 *
 * When the user adjusts the 3D view in activity detail and exits 3D mode,
 * the camera state is saved here. Feed preview cards use these overrides
 * instead of the auto-calculated camera angle.
 *
 * In-memory Map backed by AsyncStorage for persistence across sessions.
 * Written through the map preferences, which keep the activity's 3D mode
 * beside its camera so the two never disagree.
 */

import { getSetting, removeSetting, setSetting } from '@/shared/storage';
import type { TerrainCamera } from '@/features/maps/lib/cameraAngle';
import { deleteTerrainPreviewsForActivity } from './terrainPreviewCache';
import { isTerrainCamera } from './storedCamera';

const STORAGE_KEY = '@terrain_camera_overrides';
const MAX_OVERRIDES = 100;

/** In-memory cache for sync lookups */
const overrides = new Map<string, TerrainCamera>();
let initPromise: Promise<void> | null = null;
/** Moved by a wipe or a reload, so a load already in flight discards its read. */
let generation = 0;

/**
 * What a reader renders from: replaced on every change, so a subscriber can
 * tell by identity that some activity's camera moved.
 */
let snapshot: ReadonlyMap<string, TerrainCamera> = new Map();
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = new Map(overrides);
  for (const listener of listeners) listener();
}

/**
 * Called after every change to any activity's camera. A reader subscribing is
 * what starts the load, so a screen shows the saved camera whichever screen
 * the launch opened on.
 */
export function subscribeCameraOverrides(listener: () => void): () => void {
  listeners.add(listener);
  void initCameraOverrides();
  return () => {
    listeners.delete(listener);
  };
}

/** Every saved camera, as of the last change. */
export function getCameraOverridesSnapshot(): ReadonlyMap<string, TerrainCamera> {
  return snapshot;
}

/**
 * Load the stored overrides, once. Every write awaits this first, because a
 * write persists the whole map: one made before the load would replace every
 * stored camera with the few held in memory. Any screen can be the first to
 * write, a launch can open straight into an activity, so the store loads
 * itself rather than relying on whichever screen used to load it.
 */
export function initCameraOverrides(): Promise<void> {
  if (initPromise) return initPromise;
  const loading = generation;
  initPromise = (async () => {
    let stored: [string, TerrainCamera][] = [];
    try {
      const raw = await getSetting(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        // A restored backup writes this verbatim, so an entry that is not a
        // camera is dropped rather than written into the 3D page.
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          stored = Object.entries(parsed).filter((entry): entry is [string, TerrainCamera] =>
            isTerrainCamera(entry[1])
          );
        }
      }
    } catch {
      // Best effort - start with empty overrides
    }
    // A wipe or a reload while the read was out owns the map now.
    if (loading !== generation) return;
    // Stored entries go under anything already held, which is newer, and only
    // the most recent are kept if the stored data exceeds the limit.
    const merged = new Map(stored);
    for (const [id, camera] of overrides) {
      merged.delete(id);
      merged.set(id, camera);
    }
    const entries = [...merged];
    overrides.clear();
    for (const [id, camera] of entries.slice(-MAX_OVERRIDES)) {
      overrides.set(id, camera);
    }
    publish();
  })();
  return initPromise;
}

/**
 * Get saved camera override for an activity (sync lookup).
 */
export function getCameraOverride(activityId: string): TerrainCamera | undefined {
  return overrides.get(activityId);
}

/**
 * Save a camera override for an activity.
 * Also deletes any cached terrain snapshots for that activity (all styles)
 * so the feed regenerates them with the new angle.
 */
export async function setCameraOverride(activityId: string, camera: TerrainCamera): Promise<void> {
  await initCameraOverrides();
  // LRU eviction: delete oldest entry when at capacity
  if (overrides.size >= MAX_OVERRIDES && !overrides.has(activityId)) {
    const oldestKey = overrides.keys().next().value;
    if (oldestKey) overrides.delete(oldestKey);
  }
  // Re-insert to move to end of Map iteration order (most recent)
  overrides.delete(activityId);
  overrides.set(activityId, camera);
  publish();

  // Delete stale cached snapshots so they regenerate with new angle
  await deleteTerrainPreviewsForActivity(activityId);

  // Persist to AsyncStorage (fire-and-forget)
  persistOverrides();
}

/**
 * Delete a camera override for an activity, reverting to auto-calculated angle.
 * Also deletes cached terrain snapshots so the feed regenerates them. An
 * activity with no saved camera has nothing to revert, and its previews stay.
 */
export async function deleteCameraOverride(activityId: string): Promise<void> {
  await initCameraOverrides();
  if (!overrides.delete(activityId)) return;
  publish();
  await deleteTerrainPreviewsForActivity(activityId);
  persistOverrides();
}

/**
 * Force reload overrides from AsyncStorage, bypassing the initialisation guard.
 * Used after backup restore to pick up freshly-written values.
 */
export async function reloadCameraOverrides(): Promise<void> {
  generation += 1;
  initPromise = null;
  overrides.clear();
  await initCameraOverrides();
}

/**
 * Forget every override, in memory and stored. They are keyed by the
 * athlete's activity ids, so the wipe takes them with the library, and the
 * map has to go too or the next override saved writes them all back.
 */
export async function forgetCameraOverrides(): Promise<void> {
  generation += 1;
  // Nothing is stored once this returns, so there is nothing left to load.
  initPromise = Promise.resolve();
  overrides.clear();
  publish();
  await removeSetting(STORAGE_KEY).catch(() => {});
}

/** Persist current overrides map to AsyncStorage */
function persistOverrides(): void {
  const obj: Record<string, TerrainCamera> = {};
  for (const [id, camera] of overrides) {
    obj[id] = camera;
  }
  setSetting(STORAGE_KEY, JSON.stringify(obj)).catch(() => {});
}
