import type { ActivityType } from '@/types';

/** What one day on the strip holds. */
export interface StripDay {
  date: string;
  activities: { type: ActivityType; load: number }[];
}

/** One drawn mark: a bar at `x`, split by sport share from the bottom up. */
export interface StripMark {
  /** The days the mark stands for, first to last. */
  dates: string[];
  x: number;
  width: number;
  /** Fraction of the strip's height, 0 to 1. */
  height: number;
  /** Sport shares from the bottom up, largest first. Fractions sum to 1. */
  segments: { type: ActivityType; fraction: number }[];
}

/** Below this many points per day the strip draws weeks. */
export const DAY_SPACING_FLOOR = 3;
/** A day that trained but carries no load still shows, at this height. */
export const MIN_MARK_HEIGHT = 0.15;
const MAX_MARK_WIDTH = 6;
const MIN_MARK_WIDTH = 2;
/** Loads above this share of the sorted non-zero loads draw full height. */
const CLIP_PERCENTILE = 0.9;

function sportShares(days: StripDay[]): StripMark['segments'] {
  const byType = new Map<ActivityType, number>();
  let count = 0;
  for (const day of days)
    for (const a of day.activities) {
      byType.set(a.type, (byType.get(a.type) ?? 0) + Math.max(0, a.load));
      count += 1;
    }
  if (count === 0) return [];
  const total = [...byType.values()].reduce((s, v) => s + v, 0);
  // With no load anywhere every sport present takes an equal share.
  const entries = [...byType.entries()].map(([type, load]) => ({
    type,
    fraction: total > 0 ? load / total : 1 / byType.size,
  }));
  return entries.sort((a, b) => b.fraction - a.fraction || a.type.localeCompare(b.type));
}

function loadOf(days: StripDay[]): number {
  let load = 0;
  for (const day of days) for (const a of day.activities) load += Math.max(0, a.load);
  return load;
}

function hasActivities(days: StripDay[]): boolean {
  return days.some((d) => d.activities.length > 0);
}

/**
 * Lay the strip out. One mark per day while a day has `DAY_SPACING_FLOOR`
 * points or more; otherwise one mark per seven-day bin from the first day.
 * Height is the group's load against the window's clipped maximum, so one
 * outlier does not flatten the rest, and never under `MIN_MARK_HEIGHT` for a
 * group that trained.
 */
export function stripMarks(days: StripDay[], chartWidth: number): StripMark[] {
  if (days.length === 0 || chartWidth <= 0) return [];
  const daySpacing = chartWidth / Math.max(days.length - 1, 1);
  const binSize = daySpacing >= DAY_SPACING_FLOOR ? 1 : 7;

  const groups: StripDay[][] = [];
  for (let i = 0; i < days.length; i += binSize) groups.push(days.slice(i, i + binSize));

  const loads = groups.map(loadOf);
  const nonZero = loads.filter((l) => l > 0).sort((a, b) => a - b);
  const clip =
    nonZero.length > 0
      ? nonZero[Math.min(nonZero.length - 1, Math.floor(CLIP_PERCENTILE * (nonZero.length - 1)))]
      : 0;

  const spacing = chartWidth / Math.max(groups.length - 1, 1);
  const width = Math.min(MAX_MARK_WIDTH, Math.max(MIN_MARK_WIDTH, spacing * 0.6));

  const marks: StripMark[] = [];
  groups.forEach((group, idx) => {
    if (!hasActivities(group)) return;
    const centre = groups.length === 1 ? chartWidth / 2 : (idx / (groups.length - 1)) * chartWidth;
    const scaled = clip > 0 ? Math.min(1, loads[idx] / clip) : 0;
    marks.push({
      dates: group.map((d) => d.date),
      x: Math.min(Math.max(0, centre - width / 2), chartWidth - width),
      width,
      height: Math.max(MIN_MARK_HEIGHT, scaled),
      segments: sportShares(group),
    });
  });
  return marks;
}
