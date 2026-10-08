import type { LngLat } from './coordinates';

/** Where a page's camera came to rest, which a rebuilt page can open at. */
export interface SettledCamera {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

/**
 * Whether a page built to open at `built` already opens at `settled`, so a
 * reload of it restores the camera with no new page.
 */
export function pageOpensAt(
  built:
    | {
        center?: LngLat | undefined;
        zoom?: number | undefined;
        bearing?: number | undefined;
        pitch?: number | undefined;
        bounds?: unknown;
      }
    | null
    | undefined,
  settled: SettledCamera
): boolean {
  if (!built || built.bounds || !built.center) return false;
  return (
    built.center[0] === settled.center[0] &&
    built.center[1] === settled.center[1] &&
    built.zoom === settled.zoom &&
    (built.bearing ?? 0) === settled.bearing &&
    (built.pitch ?? 0) === settled.pitch
  );
}
