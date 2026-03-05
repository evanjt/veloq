/**
 * Persist and restore the regional map camera position (center + zoom).
 *
 * Follows the same in-memory cache + AsyncStorage pattern as terrainCameraOverrides.ts.
 * Returning users see their last-viewed map position instead of a computed bounds view.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@map_camera_state';

interface MapCameraState {
  center: [number, number]; // [lng, lat]
  zoom: number;
}

let state: MapCameraState | null = null;
let initialized = false;

export async function initMapCameraState(): Promise<void> {
  if (initialized) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch {
    // Best effort — start without saved state
  }
  initialized = true;
}

export function getMapCameraState(): MapCameraState | null {
  return state;
}

export function saveMapCameraState(center: [number, number], zoom: number): void {
  state = { center, zoom };
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

export async function reloadMapCameraState(): Promise<void> {
  initialized = false;
  state = null;
  await initMapCameraState();
}
