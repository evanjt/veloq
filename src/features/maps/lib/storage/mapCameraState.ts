/**
 * Persist and restore the regional map camera position (center + zoom).
 *
 * Follows the same in-memory cache + AsyncStorage pattern as terrainCameraOverrides.ts.
 * Returning users see their last-viewed map position instead of a computed bounds view.
 */

import { getSetting, setSetting } from '@/lib/backup';

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
      // Best effort — start without saved state
    }
    initialized = true;
  })();
  return initPromise;
}

// Start reading immediately on import — don't wait for useEffect
initMapCameraState();

export function getMapCameraState(): MapCameraState | null {
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
