import { useState } from 'react';

import { getMapCameraState } from '@/features/maps/lib/storage/mapCameraState';

export interface RegionalCamera {
  center: [number, number];
  zoom: number;
}

/** World view, for a first launch with nothing to open on. */
export const WORLD_CAMERA: RegionalCamera = { center: [0, 0], zoom: 2 };

/**
 * Where the regional map opens. The surface captures this on its first render,
 * so it is read once at mount and never re-read: a later value would need the
 * WebView rebuilt to reach it.
 *
 * `cameraOnBlur` is where the tab was when it lost focus, which only exists
 * within a session. The stored camera is what carries across a launch.
 */
export function useInitialRegionalCamera(cameraOnBlur: RegionalCamera | null): {
  camera: RegionalCamera;
  /** True when the camera came from the tab blur or storage, so no opening fit should move it. */
  restored: boolean;
} {
  const [stored] = useState(getMapCameraState);
  const camera = cameraOnBlur ?? stored;
  return { camera: camera ?? WORLD_CAMERA, restored: camera != null };
}
