/**
 * What narrows the feed, and the one answer to whether anything does.
 *
 * A name, a sport chip, a distance or a duration range is answered by the
 * engine's search over the whole library, and a date range by its own windowed
 * read. Every filter is additive. Either way the feed is narrowed, so the panel
 * that sets them stays on screen, the count shows and an empty result is the
 * athlete's filter rather than an empty library.
 */

import { FEED_GROUPS, type FeedGroup } from './feedActivityGroups';
import type { FeedRange } from './feedRange';

/** An inclusive span of a measure: metres for distance, moving seconds for duration. */
export interface NumericRange {
  low: number;
  high: number;
}

export interface FeedFilter {
  searchText: string;
  groups: ReadonlySet<FeedGroup>;
  range: FeedRange | null;
  distance: NumericRange | null;
  duration: NumericRange | null;
}

/** A name, a sport chip, a distance or a duration is on, so the engine's search read lists the feed. */
export function isFeedSearch({
  searchText,
  groups,
  distance,
  duration,
}: Omit<FeedFilter, 'range'>): boolean {
  return searchText.trim().length > 0 || groups.size > 0 || distance !== null || duration !== null;
}

/** A search, a sport chip, a distance, a duration or a date range is narrowing the feed. */
export function isFeedFiltered(filter: FeedFilter): boolean {
  return isFeedSearch(filter) || filter.range !== null;
}

/** The span of a measure the library holds, which a bar draws across. */
export interface MeasureBounds {
  min: number;
  max: number;
}

/**
 * The range two handles name over the library's span, or null while both rest
 * on its ends, which is no filter at all.
 */
export function numericRangeFor(
  low: number,
  high: number,
  bounds: MeasureBounds
): NumericRange | null {
  if (low <= bounds.min && high >= bounds.max) return null;
  return { low, high };
}

/** The engine's inclusive bounds on a feed read: metres and moving seconds. */
export interface FeedSizeBounds {
  minDistance?: number;
  maxDistance?: number;
  minMovingTime?: number;
  maxMovingTime?: number;
}

export function feedFilterBoundsQuery({
  distance,
  duration,
}: Pick<FeedFilter, 'distance' | 'duration'>): FeedSizeBounds {
  return {
    ...(distance && { minDistance: distance.low, maxDistance: distance.high }),
    ...(duration && { minMovingTime: duration.low, maxMovingTime: duration.high }),
  };
}

export type FeedFilterChipKind = 'date' | 'distance' | 'duration' | 'sport' | 'name';

export interface FeedFilterChip {
  kind: FeedFilterChipKind;
  label: string;
  /** The sport a sport chip names, so its cross clears that sport alone. */
  group?: FeedGroup;
}

interface ChipFormat {
  date: (range: FeedRange) => string;
  distance: (range: NumericRange) => string;
  duration: (range: NumericRange) => string;
  sport: (group: FeedGroup) => string;
}

/**
 * The chips naming what is set, in the order the collapsed row shows them: date,
 * distance, duration, each sport, then the name. A filter that is not set has none.
 */
export function feedFilterChips(filter: FeedFilter, format: ChipFormat): FeedFilterChip[] {
  const name = filter.searchText.trim();
  return [
    ...(filter.range ? [{ kind: 'date' as const, label: format.date(filter.range) }] : []),
    ...(filter.distance
      ? [{ kind: 'distance' as const, label: format.distance(filter.distance) }]
      : []),
    ...(filter.duration
      ? [{ kind: 'duration' as const, label: format.duration(filter.duration) }]
      : []),
    ...FEED_GROUPS.filter((group) => filter.groups.has(group)).map((group) => ({
      kind: 'sport' as const,
      label: format.sport(group),
      group,
    })),
    ...(name ? [{ kind: 'name' as const, label: name }] : []),
  ];
}
