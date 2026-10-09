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

const STORAGE_KEY = '@terrain_camera_overrides';
const MAX_OVERRIDES = 100;

/** In-memory cache for sync lookups */
const overrides = new Map<string, TerrainCamera>();
let initialised = false;

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

/** Called after every change to any activity's camera. */
export function subscribeCameraOverrides(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every saved camera, as of the last change. */
export function getCameraOverridesSnapshot(): ReadonlyMap<string, TerrainCamera> {
  return snapshot;
}

/**
 * Load overrides from AsyncStorage on app start.
 */
export async function initCameraOverrides(): Promise<void> {
  if (initialised) return;
  try {
    const raw = await getSetting(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, TerrainCamera>;
      const entries = Object.entries(parsed);
      // Only load the most recent entries if persisted data exceeds limit
      const toLoad = entries.length > MAX_OVERRIDES ? entries.slice(-MAX_OVERRIDES) : entries;
      for (const [id, camera] of toLoad) {
        overrides.set(id, camera);
      }
    }
  } catch {
    // Best effort - start with empty overrides
  }
  initialised = true;
  publish();
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
 * Also deletes cached terrain snapshots so the feed regenerates them.
 */
export async function deleteCameraOverride(activityId: string): Promise<void> {
  overrides.delete(activityId);
  publish();
  await deleteTerrainPreviewsForActivity(activityId);
  persistOverrides();
}

/**
 * Force reload overrides from AsyncStorage, bypassing the initialisation guard.
 * Used after backup restore to pick up freshly-written values.
 */
export async function reloadCameraOverrides(): Promise<void> {
  initialised = false;
  overrides.clear();
  await initCameraOverrides();
}

/**
 * Forget every override, in memory and stored. They are keyed by the
 * athlete's activity ids, so the wipe takes them with the library, and the
 * map has to go too or the next override saved writes them all back.
 */
export async function forgetCameraOverrides(): Promise<void> {
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
