import type { ActivityType } from '@/types';
import { getActivityCategory, SPORT_FAMILY_ORDER } from '@/shared/activity/sportCategories';
import { BAR_GAP } from '@/shared/charts/chartMarks';

/** What one day on the strip holds. */
export interface StripDay {
  date: string;
  activities: { type: ActivityType; load: number }[];
}

/** One drawn mark: a bar at `x`, split by sport group from the bottom up. */
export interface StripMark {
  /** The date the mark stands for. */
  dates: string[];
  x: number;
  width: number;
  /** Fraction of the strip's height, 0 to 1. */
  height: number;
  /** Sport group portions from the bottom up, equal and in stack order. Fractions sum to 1. */
  segments: { group: string; fraction: number }[];
  /** The date trained but carries no load, so it draws in the neutral colour. */
  noLoad: boolean;
}

/** Every active date draws at this fraction of the strip's height, whatever it carried. */
export const MARK_HEIGHT = 1;
const MAX_MARK_WIDTH = 6;
/** A slot too narrow for the bar gap and a mark keeps this share of itself, never overlapping. */
const NARROW_SLOT_SHARE = 0.6;

/** Families in the fixed order a stack draws them, bottom first. */
function inStackOrder(groups: Iterable<string>): string[] {
  const present = new Set(groups);
  return SPORT_FAMILY_ORDER.filter((family) => present.has(family));
}

/**
 * Each distinct sport family takes an equal portion, in the families' stack
 * order, so load, activity order and the language never move it. The strip
 * colours by family rather than by sport, because a sport colour each is more
 * hues than a mark a few pixels wide can tell apart.
 */
function groupShares(day: StripDay): StripMark['segments'] {
  const groups = inStackOrder(day.activities.map((a) => getActivityCategory(a.type)));
  return groups.map((group) => ({ group, fraction: 1 / groups.length }));
}

/**
 * What one mark fills, bottom-up. A date that carries load draws its sport
 * portions. A date that trained without load has no load to colour by, so it
 * draws once as a neutral outline at the same height: a sport colour there
 * would read as a recorded session, which is what a window of unmeasured days
 * must not claim.
 */
export function markFills(
  mark: StripMark,
  mutedColor: string,
  colorOf: (group: string) => string
): { color: string; fraction: number; outline: boolean }[] {
  if (mark.noLoad) return [{ color: mutedColor, fraction: 1, outline: true }];
  return mark.segments.map((segment) => ({
    color: colorOf(segment.group),
    fraction: segment.fraction,
    outline: false,
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
  // The chart bar's surface gap to the next date, under the strip's own narrower cap.
  const width = Math.min(
    MAX_MARK_WIDTH,
    spacing > 2 * BAR_GAP ? spacing - BAR_GAP : spacing * NARROW_SLOT_SHARE
  );

  const marks: StripMark[] = [];
  days.forEach((day, idx) => {
    if (day.activities.length === 0) return;
    const centre = days.length === 1 ? chartWidth / 2 : idx * spacing;
    marks.push({
      dates: [day.date],
      x: Math.min(Math.max(0, centre - width / 2), chartWidth - width),
      width,
      height: MARK_HEIGHT,
      segments: groupShares(day),
      noLoad: day.activities.every((a) => a.load <= 0),
    });
  });
  return marks;
}

/** What the strip's key names: the sport groups drawn in colour, and whether any mark is neutral. */
export interface StripKey {
  /** Sport groups with at least one loaded date, in stack order. */
  groups: string[];
  /** At least one date trained without load and draws neutral. */
  noLoad: boolean;
}

/** The sport groups and neutral state the given days draw, so the key names only what the strip shows. */
export function stripKey(days: StripDay[]): StripKey {
  const groups = new Set<string>();
  let noLoad = false;
  for (const day of days) {
    if (day.activities.length === 0) continue;
    if (day.activities.every((a) => a.load <= 0)) {
      noLoad = true;
      continue;
    }
    for (const a of day.activities) groups.add(getActivityCategory(a.type));
  }
  return { groups: inStackOrder(groups), noLoad };
}
