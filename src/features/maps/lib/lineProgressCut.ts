/**
 * Cuts stretches out of a line by the fractions of its length that a
 * `line-progress` expression reads, so a layer can draw those stretches alone.
 */

import { featureCollection, lineFeature, type LngLat } from './coordinates';

const RADIANS = Math.PI / 180;

/** One point of the line and its distance along it. */
interface Placed {
  point: LngLat;
  along: number;
}

/**
 * Each point with its distance along the line, on a local flat projection.
 * Over the few kilometres of a section the scale is the same along the line,
 * so the fractions of length match the renderer's to well under a pixel.
 */
function placeAlong(line: readonly LngLat[]): Placed[] {
  const placed: Placed[] = [];
  let previous: Placed | undefined;
  for (const point of line) {
    let along = 0;
    if (previous) {
      const [lng0, lat0] = previous.point;
      const [lng1, lat1] = point;
      const dx = (lng1 - lng0) * Math.cos(((lat0 + lat1) / 2) * RADIANS);
      along = previous.along + Math.hypot(dx, lat1 - lat0);
    }
    previous = { point, along };
    placed.push(previous);
  }
  return placed;
}

/** The point `distance` along the line, between the two points it falls between. */
function pointAt(placed: readonly Placed[], distance: number): LngLat {
  let before = placed[0];
  for (const after of placed) {
    if (before && after.along >= distance) {
      const span = after.along - before.along;
      const t = span > 0 ? (distance - before.along) / span : 0;
      const [lng0, lat0] = before.point;
      const [lng1, lat1] = after.point;
      return [lng0 + (lng1 - lng0) * t, lat0 + (lat1 - lat0) * t];
    }
    before = after;
  }
  return before ? before.point : [0, 0];
}

/**
 * Each `[start, end]` range of `line`, a fraction of its length from 0 to 1, as
 * its own LineString, its ends placed between the points they fall between. A
 * range with no length, or a line with none, gives nothing.
 */
export function cutLineByProgress(
  line: readonly LngLat[],
  ranges: readonly (readonly [number, number])[]
): GeoJSON.FeatureCollection {
  const placed = placeAlong(line);
  const total = placed[placed.length - 1]?.along ?? 0;
  if (!(total > 0)) return featureCollection([]);

  return featureCollection(
    ranges.map(([start, end]) => {
      const from = Math.max(0, start) * total;
      const to = Math.min(1, end) * total;
      if (!(to > from)) return null;
      const inside = placed
        .filter(({ along }) => along > from && along < to)
        .map(({ point }) => point);
      return lineFeature([pointAt(placed, from), ...inside, pointAt(placed, to)]);
    })
  );
}
