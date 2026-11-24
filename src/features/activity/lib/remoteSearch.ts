/**
 * When the feed offers a search of the athlete's account, and what that
 * search asks.
 *
 * The device's own search is the fast path and always runs first. The account
 * is offered only once that search has nothing more to show, and only when
 * there is a name or a date range to ask with: the account's own search takes
 * a name, and a range alone is listed by its days. A sport or a size bound on
 * its own is no question the account can answer, so it narrows an ask that has
 * one of the two and offers nothing without.
 */

import type { RemoteActivityQuery } from '@/shared/native/remoteActivitySearch';
import { dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';
import { feedSportGroup } from './feedActivityGroups';
import { feedFilterBoundsQuery, type FeedFilter } from './feedFilter';

/** A name or a date range is set, which is what the account can be asked with. */
export function canSearchAccount(filter: FeedFilter): boolean {
  return filter.searchText.trim().length > 0 || filter.range !== null;
}

/** What decides the offer: the filter, and where the local read stands. */
interface RemoteSearchOfferState {
  filter: FeedFilter;
  /** The held source answers the account search. A source that does not is never offered one. */
  searchable: boolean;
  /** The local read is still loading its first page. */
  loading: boolean;
  /** The local read has a further page to fetch. */
  hasMore: boolean;
  /** The local read is fetching that page now. */
  fetchingMore: boolean;
  /** The local read failed, so it has not run out. */
  failed: boolean;
}

/** The local list has run out and the filter names something the account can be asked. */
export function shouldOfferRemoteSearch({
  filter,
  searchable,
  loading,
  hasMore,
  fetchingMore,
  failed,
}: RemoteSearchOfferState): boolean {
  return searchable && canSearchAccount(filter) && !loading && !fetchingMore && !hasMore && !failed;
}

/** The feed's filter as the account search takes it. */
export function remoteSearchQuery(filter: FeedFilter): RemoteActivityQuery {
  const bounds = feedFilterBoundsQuery(filter);
  return {
    needle: filter.searchText.trim(),
    sportFamilies: [...filter.groups].map(feedSportGroup),
    ...(filter.range && {
      oldestTs: dayStartEpochSeconds(filter.range.oldest),
      newestTs: dayEndEpochSeconds(filter.range.newest),
    }),
    ...bounds,
  };
}

/** A key that changes whenever the question does, so an answer is never shown under another. */
export function remoteSearchKey(filter: FeedFilter): string {
  return JSON.stringify(remoteSearchQuery(filter));
}
