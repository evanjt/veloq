/**
 * Camera rules for the detection preview map.
 *
 * A preview runs over the whole geographic component containing the chosen
 * point, so its result can carry sections hundreds of kilometres away. Framing
 * all of them leaves the area the user picked as a few pixels, so the camera is
 * held to that centre's ~5 km bin and only tightens onto the geometry inside
 * it.
 */
import { boundsOfLngLat, type LngLat, type LngLatBounds } from '@/features/maps/lib/coordinates';

/** Bin edge of the centre grid, in degrees. Mirrors `BIN_DEG` in the engine. */
export const PREVIEW_BIN_DEG = 0.045;

/** Fractional padding applied to the framed geometry before clamping. */
export const PREVIEW_AREA_BOUNDS_PADDING = 0.15;

/** Floor under the framed box, so a single point does not fit to max zoom. */
export const PREVIEW_MIN_EXTENT_DEG = 0.0045;

export interface PreviewAreaCentre {
  /** "lat_bin:lng_bin" at ~5 km, the key the engine ranks areas by. */
  binKey?: string | null;
  lat: number;
  lng: number;
}

function binIndices(binKey: string | null | undefined): [number, number] | null {
  if (!binKey) return null;
  const parts = binKey.split(':');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isInteger(lat) || !Number.isInteger(lng)) return null;
  return [lat, lng];
}

/**
 * The ~5 km box of the selected riding area, from its bin key where it parses
 * and from a bin-wide box around the point otherwise. Null when the centre is
 * missing or not drawable.
 */
export function previewAreaBounds(centre: PreviewAreaCentre | null): LngLatBounds | null {
  if (!centre || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lng)) return null;

  const indices = binIndices(centre.binKey);
  if (indices) {
    const [latBin, lngBin] = indices;
    return {
      sw: [lngBin * PREVIEW_BIN_DEG, latBin * PREVIEW_BIN_DEG],
      ne: [(lngBin + 1) * PREVIEW_BIN_DEG, (latBin + 1) * PREVIEW_BIN_DEG],
    };
  }

  const half = PREVIEW_BIN_DEG / 2;
  return {
    sw: [centre.lng - half, centre.lat - half],
    ne: [centre.lng + half, centre.lat + half],
  };
}

function contains(area: LngLatBounds, [lng, lat]: LngLat): boolean {
  return lng >= area.sw[0] && lng <= area.ne[0] && lat >= area.sw[1] && lat <= area.ne[1];
}

function grownToFloor(min: number, max: number): [number, number] {
  const short = PREVIEW_MIN_EXTENT_DEG - (max - min);
  if (short <= 0) return [min, max];
  return [min - short / 2, max + short / 2];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Bounds the preview camera should hold for a selected centre and the decoded
 * section geometry of a run. Only points inside the area count, and the result
 * never reaches past it.
 */
export function previewCameraBounds(
  centre: PreviewAreaCentre | null,
  geometries: readonly (readonly LngLat[])[]
): LngLatBounds | null {
  const area = previewAreaBounds(centre);
  if (!area) return null;

  const inside: LngLat[] = [];
  for (const coords of geometries) {
    for (const point of coords) {
      if (Number.isFinite(point[0]) && Number.isFinite(point[1]) && contains(area, point)) {
        inside.push(point);
      }
    }
  }

  const framed = boundsOfLngLat(inside, PREVIEW_AREA_BOUNDS_PADDING);
  if (!framed) return area;

  const [minLng, maxLng] = grownToFloor(framed.sw[0], framed.ne[0]);
  const [minLat, maxLat] = grownToFloor(framed.sw[1], framed.ne[1]);

  return {
    sw: [clamp(minLng, area.sw[0], area.ne[0]), clamp(minLat, area.sw[1], area.ne[1])],
    ne: [clamp(maxLng, area.sw[0], area.ne[0]), clamp(maxLat, area.sw[1], area.ne[1])],
  };
}
