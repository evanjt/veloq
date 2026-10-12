/**
 * What narrows the feed, and the one answer to whether anything does.
 *
 * A search and a sport chip are answered by the engine's search over the whole
 * library, and a date range by its own windowed read. Either way the feed is
 * narrowed, so the controls that set it stay on screen, the count shows and an
 * empty result is the athlete's filter rather than an empty library.
 */

import { FEED_GROUPS, FEED_GROUP_LABELS, type FeedGroup } from './feedActivityGroups';
import { FEED_RANGE_LABELS, type FeedRange, type FeedRangePreset } from './feedRange';

export interface FeedFilter {
  searchText: string;
  groups: ReadonlySet<FeedGroup>;
  range: FeedRange | null;
}

/** A search or a sport chip is on, so the engine's search read lists the feed. */
export function isFeedSearch({ searchText, groups }: Omit<FeedFilter, 'range'>): boolean {
  return searchText.trim().length > 0 || groups.size > 0;
}

/** A search, a sport chip or a date range is narrowing the feed. */
export function isFeedFiltered(filter: FeedFilter): boolean {
  return isFeedSearch(filter) || filter.range !== null;
}

/** The labels of the chips narrowing the feed as translation keys, in the order the row shows them. */
export function feedFilterLabelKeys(
  groups: ReadonlySet<FeedGroup>,
  rangePreset: FeedRangePreset | null
): string[] {
  const sports = FEED_GROUPS.filter((group) => groups.has(group)).map(
    (group) => FEED_GROUP_LABELS[group]
  );
  return rangePreset ? [...sports, FEED_RANGE_LABELS[rangePreset]] : sports;
}
