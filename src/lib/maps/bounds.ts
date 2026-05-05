/**
 * MapLibre v11 expects bounds as a tuple `[west, south, east, north]` and
 * padding as `{ top, right, bottom, left }`. The internal `MapBounds` shape
 * (`{ ne: [lng, lat], sw: [lng, lat] }`) and historical padding shape
 * (`paddingTop` etc.) are kept across the codebase for now; these helpers
 * convert at the v11 boundary.
 */

import type { ViewPadding } from '@maplibre/maplibre-react-native';

export interface MapBoundsObject {
  ne: [number, number];
  sw: [number, number];
}

export type LngLatBoundsTuple = [number, number, number, number];

export function toLngLatBounds(b: MapBoundsObject): LngLatBoundsTuple {
  return [b.sw[0], b.sw[1], b.ne[0], b.ne[1]];
}

export interface LegacyPadding {
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
}

export function toViewPadding(p: LegacyPadding): ViewPadding {
  return {
    top: p.paddingTop ?? 0,
    right: p.paddingRight ?? 0,
    bottom: p.paddingBottom ?? 0,
    left: p.paddingLeft ?? 0,
  };
}
