import type { LngLatBounds } from './coordinates';
import type { MapCameraSpec } from './htmlBuilders/mapSurface';
import { visibleMapInset, type MapEdgeInset, type VisibleMapInsetInput } from './activityCamera';

/** MapLibre's tile size, which the world measures in at zoom 0. */
const WORLD_TILE = 512;

export interface PaddedCamera {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  padding: MapEdgeInset;
}

export type SettleCameraAction =
  | { kind: 'none' }
  | { kind: 'refit'; padding: MapEdgeInset }
  | { kind: 'ease'; padding: MapEdgeInset };

/**
 * The one camera padding of a map: what covers it, as the part left visible. The flat and the 3D
 * surface both take it, so one input pads both the same.
 */
export function cameraPadding(input: VisibleMapInsetInput): MapEdgeInset {
  return visibleMapInset(input);
}

/**
 * The opening camera of a map that fits a track to the part of the page nothing covers: the inset
 * is the camera's padding, so its centre, tilt and rotate work around what the athlete sees.
 */
export function paddedFit(bounds: LngLatBounds, inset: MapEdgeInset): MapCameraSpec {
  return { bounds, padding: inset, padCamera: true };
}

export function sameInset(a: MapEdgeInset, b: MapEdgeInset): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

function mercator(lng: number, lat: number): [number, number] {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

/**
 * The most zoomed-in camera that still holds `bounds` inside the part of a `width` by `height` map
 * that `padding` leaves, at `bearing`. The bounds are turned with the map, so a turned camera needs
 * the room its rotated box takes.
 */
export function fitZoom(
  bounds: LngLatBounds,
  size: { width: number; height: number },
  padding: MapEdgeInset,
  bearing = 0
): number {
  const corners = [
    mercator(bounds.sw[0], bounds.sw[1]),
    mercator(bounds.ne[0], bounds.sw[1]),
    mercator(bounds.ne[0], bounds.ne[1]),
    mercator(bounds.sw[0], bounds.ne[1]),
  ];
  const angle = (bearing * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const xs = corners.map(([x, y]) => x * cos + y * sin);
  const ys = corners.map(([x, y]) => -x * sin + y * cos);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const room = {
    width: Math.max(1, size.width - padding.left - padding.right),
    height: Math.max(1, size.height - padding.top - padding.bottom),
  };
  const zoomX = spanX > 0 ? Math.log2(room.width / (spanX * WORLD_TILE)) : Infinity;
  const zoomY = spanY > 0 ? Math.log2(room.height / (spanY * WORLD_TILE)) : Infinity;
  return Math.min(zoomX, zoomY);
}

/**
 * The camera a map opens with. It keeps its bearing and pitch and carries the padding, so its centre
 * is the middle of what the athlete sees. `refit` is set when its zoom no longer holds the track in
 * that smaller frame, and the page then fits the track to the frame at that bearing.
 */
export function openingCamera(
  camera: Omit<PaddedCamera, 'padding'>,
  padding: MapEdgeInset,
  track: { bounds: LngLatBounds | null | undefined; width: number; height: number }
): { camera: PaddedCamera; refit: boolean } {
  const refit =
    !!track.bounds && camera.zoom > fitZoom(track.bounds, track, padding, camera.bearing) + 1e-6;
  return { camera: { ...camera, padding }, refit };
}

/**
 * What a map does when the sheet settles and the inset changes. An unmoved map refits the track to
 * the new visible area. A map the athlete moved keeps the point at the old visible centre at the new
 * one, which is an ease with the new padding and the same centre. An unchanged inset does nothing,
 * and that is every settle above Half, where the covered height stops growing.
 */
export function settleCameraAction(input: {
  previous: MapEdgeInset;
  next: MapEdgeInset;
  athleteMoved: boolean;
}): SettleCameraAction {
  if (sameInset(input.previous, input.next)) return { kind: 'none' };
  return input.athleteMoved
    ? { kind: 'ease', padding: input.next }
    : { kind: 'refit', padding: input.next };
}
