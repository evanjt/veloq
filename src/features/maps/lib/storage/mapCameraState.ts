/**
 * Persist and restore the regional map camera position (center + zoom).
 *
 * Follows the same in-memory cache + AsyncStorage pattern as terrainCameraOverrides.ts.
 * Returning users see their last-viewed map position instead of a computed bounds view.
 */

import { getSetting, setSetting } from '@/shared/storage';
import { getEngine } from '@/shared/native/engine';

const STORAGE_KEY = '@map_camera_state';

interface MapCameraState {
  center: [number, number]; // [lng, lat]
  zoom: number;
}

let state: MapCameraState | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

export function initMapCameraState(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (initialized) return;
    try {
      const raw = await getSetting(STORAGE_KEY);
      if (raw) state = JSON.parse(raw);
    } catch {
      // Best effort - start without saved state
    }
    initialized = true;
  })();
  return initPromise;
}

// Start reading immediately on import - don't wait for useEffect
initMapCameraState();

/**
 * The saved camera, or null. Synchronous, because the map surface captures its
 * camera on the first render and a value that arrives a tick later would need
 * the whole WebView rebuilt to be used.
 *
 * The async init above populates the cache in the ordinary case. This falls
 * back to a direct engine read, which is what `getSetting` does first anyway
 * and is synchronous; only the AsyncStorage leg of the transition needs the
 * promise.
 */
export function getMapCameraState(): MapCameraState | null {
  if (state) return state;
  try {
    const raw = getEngine()?.getSetting(STORAGE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch {
    // Best effort - a malformed value reads as no saved camera
  }
  return state;
}

export function saveMapCameraState(center: [number, number], zoom: number): void {
  state = { center, zoom };
  setSetting(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

export async function reloadMapCameraState(): Promise<void> {
  initialized = false;
  state = null;
  initPromise = null;
  await initMapCameraState();
}
