import type { SkylineData } from './skylineDecoder';

/** Zones on the intervals.icu skyline scale, Z1 the easiest. */
const SKYLINE_ZONE_COUNT = 7;

/** The easiest zone's height, tall enough to see on a feed card. */
const SKYLINE_SEGMENT_FLOOR = 6;

function clampZone(zone: number): number {
  return Math.min(Math.max(zone, 1), SKYLINE_ZONE_COUNT);
}

/**
 * Height of one skyline segment, rising evenly with its zone from a floor at
 * Z1 to `maxHeight` at the top zone, so the bar reads by height as well as by
 * hue and no zone is too thin to see.
 */
export function skylineSegmentHeight(zone: number, maxHeight: number): number {
  const floor = Math.min(SKYLINE_SEGMENT_FLOOR, maxHeight);
  const step = (clampZone(zone) - 1) / (SKYLINE_ZONE_COUNT - 1);
  return floor + (maxHeight - floor) * step;
}

export interface SkylineZoneTotal {
  zone: number;
  seconds: number;
}

/** Seconds spent in each zone the skyline visits, easiest zone first. */
export function skylineZoneTotals(decoded: SkylineData): SkylineZoneTotal[] {
  const seconds = new Map<number, number>();
  for (const interval of decoded.intervals) {
    const zone = clampZone(interval.zone);
    seconds.set(zone, (seconds.get(zone) ?? 0) + interval.duration);
  }
  return [...seconds.entries()]
    .filter(([, total]) => total > 0)
    .sort(([a], [b]) => a - b)
    .map(([zone, total]) => ({ zone, seconds: total }));
}
