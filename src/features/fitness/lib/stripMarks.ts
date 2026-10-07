import type { ActivityType } from '@/types';

/** What one day on the strip holds. */
export interface StripDay {
  date: string;
  activities: { type: ActivityType; load: number }[];
}

/** One drawn mark: a bar at `x`, split by sport from the bottom up. */
export interface StripMark {
  /** The date the mark stands for. */
  dates: string[];
  x: number;
  width: number;
  /** Fraction of the strip's height, 0 to 1. */
  height: number;
  /** Sport portions from the bottom up, equal and in name order. Fractions sum to 1. */
  segments: { type: ActivityType; fraction: number }[];
  /** The date trained but carries no load, so it draws in the neutral colour. */
  noLoad: boolean;
}

/** Every active date draws at this fraction of the strip's height, whatever it carried. */
export const MARK_HEIGHT = 1;
const MAX_MARK_WIDTH = 6;
/** The share of a date's slot a mark fills, the rest being the gap to the next date. */
const SLOT_SHARE = 0.6;

/** Each distinct sport takes an equal portion, in name order, so load and activity order never move it. */
function sportShares(day: StripDay): StripMark['segments'] {
  const types = [...new Set(day.activities.map((a) => a.type))].sort((a, b) => a.localeCompare(b));
  return types.map((type) => ({ type, fraction: 1 / types.length }));
}

/**
 * What one mark fills, bottom-up. A date that carries load draws its sport
 * portions. A date that trained without load has no load to colour by, so it
 * draws once in the muted neutral at the same height: a sport colour there
 * would read as a recorded session, which is what a window of unmeasured days
 * must not claim.
 */
export function markFills(
  mark: StripMark,
  mutedColor: string,
  colorOf: (type: ActivityType) => string
): { color: string; fraction: number }[] {
  if (mark.noLoad) return [{ color: mutedColor, fraction: 1 }];
  return mark.segments.map((segment) => ({
    color: colorOf(segment.type),
    fraction: segment.fraction,
  }));
}

/**
 * Lay the strip out: one mark per date that has an activity, none for a rest
 * day, each of constant height and of a width bound to its date slot so
 * neighbouring dates never overlap at any range.
 */
export function stripMarks(days: StripDay[], chartWidth: number): StripMark[] {
  if (days.length === 0 || chartWidth <= 0) return [];
  const spacing = chartWidth / Math.max(days.length - 1, 1);
  const width = Math.min(MAX_MARK_WIDTH, spacing * SLOT_SHARE);

  const marks: StripMark[] = [];
  days.forEach((day, idx) => {
    if (day.activities.length === 0) return;
    const centre = days.length === 1 ? chartWidth / 2 : idx * spacing;
    marks.push({
      dates: [day.date],
      x: Math.min(Math.max(0, centre - width / 2), chartWidth - width),
      width,
      height: MARK_HEIGHT,
      segments: sportShares(day),
      noLoad: day.activities.every((a) => a.load <= 0),
    });
  });
  return marks;
}

/** What the strip's key names: the sports drawn in colour, and whether any mark is neutral. */
export interface StripKey {
  /** Sports with at least one loaded date, in name order. */
  sports: ActivityType[];
  /** At least one date trained without load and draws neutral. */
  noLoad: boolean;
}

/** The sports and neutral state the given days draw, so the key names only what the strip shows. */
export function stripKey(days: StripDay[]): StripKey {
  const sports = new Set<ActivityType>();
  let noLoad = false;
  for (const day of days) {
    if (day.activities.length === 0) continue;
    if (day.activities.every((a) => a.load <= 0)) {
      noLoad = true;
      continue;
    }
    for (const a of day.activities) sports.add(a.type);
  }
  return { sports: [...sports].sort((a, b) => a.localeCompare(b)), noLoad };
}
