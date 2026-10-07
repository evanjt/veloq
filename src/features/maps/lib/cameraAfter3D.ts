export interface Camera3DState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

/**
 * The camera the flat map opens with after 3D. The 3D centre and zoom carry
 * over and bearing and pitch come back flat, since a flat camera spec holds
 * neither. With no 3D camera the flat one from before 3D stands.
 */
export function cameraAfter3D<T>(
  camera3D: Camera3DState | null,
  camera2D: T | null
): T | { center: [number, number]; zoom: number } | null {
  if (!camera3D) return camera2D;
  return { center: camera3D.center, zoom: camera3D.zoom };
}
