import type { LngLat, LngLatBounds } from './coordinates';
import type { MapEdgeInset } from './activityCamera';
import type { MapCameraSpec, MapPadding } from './htmlBuilders/mapSurface';

/** Where a page's camera came to rest, which a rebuilt page can open at. */
export interface SettledCamera {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

/** What a page frames: the subject a refit fits and the inset it fits it into. */
export interface PageFrame {
  bounds: LngLatBounds | null | undefined;
  padding: MapEdgeInset;
}

function edges(padding: MapPadding): MapEdgeInset {
  return typeof padding === 'number'
    ? { top: padding, right: padding, bottom: padding, left: padding }
    : padding;
}

/** The frame a camera that pads itself holds, or null for a page that only margins its fit. */
export function frameOf(camera: MapCameraSpec): PageFrame | null {
  if (camera.padCamera !== true || camera.padding === undefined) return null;
  return { bounds: camera.subjectBounds ?? camera.bounds, padding: edges(camera.padding) };
}

/** The frame after a move that names a new subject, a new inset or both. */
export function movedFrame(
  frame: PageFrame | null,
  move: { bounds?: LngLatBounds | undefined; padding?: MapPadding | undefined }
): PageFrame | null {
  if (!frame) return frame;
  return {
    bounds: move.bounds ?? frame.bounds,
    padding: move.padding === undefined ? frame.padding : edges(move.padding),
  };
}

function sameEdges(a: MapEdgeInset, b: MapEdgeInset): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/**
 * The one camera a page opens with when it comes back at where the athlete left it, for a remount,
 * a rebuild and an iOS reload alike. It keeps the camera, carries the frame's padding so its centre
 * is the middle of what the athlete sees, holds the subject bounds apart for a later refit, and is
 * pinned so the relief turn leaves a view the athlete chose.
 */
export function restoredCamera(
  settled: {
    center?: LngLat | undefined;
    zoom?: number | undefined;
    bearing?: number | undefined;
    pitch?: number | undefined;
  },
  frame: PageFrame
): MapCameraSpec {
  return {
    center: settled.center,
    zoom: settled.zoom,
    bearing: settled.bearing ?? 0,
    pitch: settled.pitch ?? 0,
    padding: frame.padding,
    padCamera: true,
    ...(frame.bounds ? { subjectBounds: frame.bounds } : {}),
    pinned: true,
  };
}

/**
 * Whether a page built to open at `built` already opens at `settled` in `padding`, so a reload of
 * it restores the camera with no new page.
 */
export function pageOpensAt(
  built:
    | {
        center?: LngLat | undefined;
        zoom?: number | undefined;
        bearing?: number | undefined;
        pitch?: number | undefined;
        bounds?: unknown;
        padding?: unknown;
      }
    | null
    | undefined,
  settled: SettledCamera,
  padding?: MapEdgeInset
): boolean {
  if (!built || built.bounds || !built.center) return false;
  if (padding && !(built.padding && sameEdges(built.padding as MapEdgeInset, padding)))
    return false;
  return (
    built.center[0] === settled.center[0] &&
    built.center[1] === settled.center[1] &&
    built.zoom === settled.zoom &&
    (built.bearing ?? 0) === settled.bearing &&
    (built.pitch ?? 0) === settled.pitch
  );
}
