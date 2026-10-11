import type { SkylineData } from './skylineDecoder';

/** Zones on the intervals.icu skyline scale, Z1 the easiest. */
const SKYLINE_ZONE_COUNT = 7;

function clampZone(zone: number): number {
  return Math.min(Math.max(zone, 1), SKYLINE_ZONE_COUNT);
}

/**
 * Height of one skyline segment, rising with its zone up to `maxHeight` at the
 * top zone, so the bar reads by height as well as by hue.
 */
export function skylineSegmentHeight(zone: number, maxHeight: number): number {
  return (maxHeight * clampZone(zone)) / SKYLINE_ZONE_COUNT;
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
