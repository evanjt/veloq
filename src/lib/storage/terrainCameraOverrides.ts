/**
 * Per-activity camera override store for 3D terrain previews.
 *
 * When the user adjusts the 3D view in activity detail and exits 3D mode,
 * the camera state is saved here. Feed preview cards use these overrides
 * instead of the auto-calculated camera angle.
 *
 * In-memory Map backed by AsyncStorage for persistence across sessions.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TerrainCamera } from '@/lib/utils/cameraAngle';
import { deleteTerrainPreviewsForActivity } from './terrainPreviewCache';

const STORAGE_KEY = '@terrain_camera_overrides';

/** In-memory cache for sync lookups */
const overrides = new Map<string, TerrainCamera>();
let initialized = false;

/**
 * Load overrides from AsyncStorage on app start.
 */
export async function initCameraOverrides(): Promise<void> {
  if (initialized) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, TerrainCamera>;
      for (const [id, camera] of Object.entries(parsed)) {
        overrides.set(id, camera);
      }
    }
  } catch {
    // Best effort — start with empty overrides
  }
  initialized = true;
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
  overrides.set(activityId, camera);

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
  await deleteTerrainPreviewsForActivity(activityId);
  persistOverrides();
}

/**
 * Force reload overrides from AsyncStorage, bypassing the initialization guard.
 * Used after backup restore to pick up freshly-written values.
 */
export async function reloadCameraOverrides(): Promise<void> {
  initialized = false;
  overrides.clear();
  await initCameraOverrides();
}

/** Persist current overrides map to AsyncStorage */
function persistOverrides(): void {
  const obj: Record<string, TerrainCamera> = {};
  for (const [id, camera] of overrides) {
    obj[id] = camera;
  }
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(obj)).catch(() => {});
}
