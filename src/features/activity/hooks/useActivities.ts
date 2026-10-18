import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { readActivityRecord } from '@/features/activity/lib/engineActivityRecord';
import {
  DETAIL_STREAM_TYPES,
  readStreams,
  requestStreams,
} from '@/features/activity/lib/engineStreams';
import { formatLocalDate } from '@/shared/format/format';
import { addDaysToDay, dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';
import { CACHE } from '@/shared/app/constants';
import { queryKeys } from '@/shared/query/queryKeys';
import { hasStarted, type ActivityRecord } from 'veloqrs';
import { freshLoginTimeline, type TrackWait } from '@/shared/debug/freshLoginTimeline';
import { getEngine } from '@/shared/native/engine';
import { useEngineBody } from '@/shared/native/engineBodies';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import type { Activity, ActivityInterval, ActivityStreams, FeedCard } from '@/types';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
import { useDetailCoordinates } from './useDetailCoordinates';
import { readActivities } from '@/shared/native/storedActivities';
import { feedSportGroup, type FeedGroup } from '../lib/feedActivityGroups';
import { firstRangePage, olderRangePage, type FeedRange } from '../lib/feedRange';
import { isFeedSearch } from '../lib/feedFilter';

/**
 * Ask Rust to fill a window the default sync may not cover.
 *
 * The launch sync fetches the runs its census says are owed inside the last 90
 * days, and nothing when none are owed. The timeline slider and the infinite
 * feed both reach further back than that, so a window they open is asked for
 * and the engine event wakes the read when it lands.
 *
 * The ask carries no memory of its own. The engine answers `NotOwed` for a
 * window its census says is already local and current, which survives a
 * relaunch, where the `Set` of `oldest:newest` keys that used to sit here did
 * not: every launch re-downloaded the pages the feed had already scrolled to,
 * and the key carried no athlete, so a second sign-in read the first one's
 * coverage.
 */
function requestActivityWindow(oldest: string, newest: string): void {
  const engine = getEngine();
  if (!engine?.syncActivitiesWindow) return;
  try {
    if (hasStarted(engine.syncActivitiesWindow(oldest, newest))) {
      // The download the surfaces name starts here and nowhere else, so this
      // is where they are told it is running. A refusal, `NotOwed` included,
      // names nothing.
      useSyncDateRange.getState().windowAccepted();
    }
  } catch {
    // A throw is a settled failure, and the next ask reaches the engine again.
  }
}

/**
 * Ask the engine for a window, without reading it. The ask goes out when the
 * window or the athlete changes, and nowhere else: a window refused because
 * the launch sync holds the exclusive slot is kept owed and started as the
 * slot frees, and one that failed for the connection is started again on the
 * online edge, both by the engine.
 */
export function useActivityWindowRequest(oldest: string, newest: string, enabled = true): void {
  const athleteId = useAuthStore((s) => s.athleteId);

  const askForWindow = useCallback(() => {
    if (!enabled || !athleteId) return;
    requestActivityWindow(oldest, newest);
  }, [enabled, athleteId, oldest, newest]);

  useEffect(askForWindow, [askForWindow]);
}

interface UseActivitiesOptions {
  /** Number of days to fetch (from today backwards) */
  days?: number;
  /** Start date (YYYY-MM-DD) - overrides days */
  oldest?: string;
  /** End date (YYYY-MM-DD) - defaults to today */
  newest?: string;
  /** Whether to enable the query (default: true) */
  enabled?: boolean;
}

/**
 * Standard activities hook for fixed date ranges.
 * Use this for specific date range queries (e.g., stats page, wellness).
 */
export function useActivities(options: UseActivitiesOptions = {}) {
  const { days, oldest, newest, enabled = true } = options;
  const athleteId = useAuthStore((s) => s.athleteId);

  // Both ends are always resolved. An `oldest` with no `newest` used to leave
  // the far end undefined, which reaches the engine as NaN and reads back an
  // empty window, so an open-ended range read nothing at all.
  const today = new Date();
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - (days || 30));
  const queryOldest = oldest ?? formatLocalDate(windowStart);
  const queryNewest = newest ?? formatLocalDate(today);

  useEngineChannel('activities', queryKeys.activities.all);
  useActivityWindowRequest(queryOldest, queryNewest, enabled);

  return useQuery<Activity[]>({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.activities.list(athleteId ?? 'anon', queryOldest, queryNewest),
    queryFn: () => readActivities(queryOldest, queryNewest),
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: CACHE.HOUR, // 1 hour - keep in memory for navigation
    placeholderData: keepPreviousData,
    enabled: enabled && !!athleteId,
  });
}

/** The feed's cards over a date window, newest first, typed by the engine. */
function readFeedCards(oldest: string, newest: string): FeedCard[] {
  const engine = getEngine();
  if (!engine?.getFeedCards) return [];
  return engine.getFeedCards(
    dayStartEpochSeconds(oldest),
    dayEndEpochSeconds(newest)
  ) as FeedCard[];
}

/**
 * Page size for infinite scroll (in days)
 */
const PAGE_SIZE_DAYS = 30;

/**
 * Infinite scroll for activity feed.
 *
 * Stale-while-revalidate: cached activities show instantly on app open,
 * background refetch picks up new activities.
 */
export function useInfiniteActivities() {
  const athleteId = useAuthStore((s) => s.athleteId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: oldestActivityDate } = useOldestActivityDate();
  const oldestDay = oldestActivityDate ? formatLocalDate(oldestActivityDate) : null;

  useEngineChannel('activities', queryKeys.activities.infinite.all);

  const query = useInfiniteQuery<FeedCard[], Error>({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.activities.infinite.byAthlete(athleteId ?? 'anon'),
    queryFn: ({ pageParam }) => {
      const { oldest, newest } = pageParam as {
        oldest: string;
        newest: string;
      };
      // Scrolling past what the launch sync covers opens a window Rust has
      // not fetched. Ask for it, then read; the engine event brings it in.
      requestActivityWindow(oldest, newest);
      return readFeedCards(oldest, newest);
    },
    initialPageParam: (() => {
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - PAGE_SIZE_DAYS);
      return {
        oldest: formatLocalDate(thirtyDaysAgo),
        newest: formatLocalDate(today),
      };
    })(),
    getNextPageParam: (_lastPage, _allPages, lastPageParam) => {
      // An empty page may still be a window the engine has not fetched.
      const pageParam = lastPageParam as { oldest: string };
      const nextEnd = addDaysToDay(pageParam.oldest, -1);
      if (oldestDay && nextEnd < oldestDay) return undefined;

      return {
        oldest: addDaysToDay(nextEnd, -PAGE_SIZE_DAYS),
        newest: nextEnd,
      };
    },
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) => {
      const first = firstPageParam as { newest: string };
      const today = formatLocalDate(new Date());
      if (first.newest >= today) return undefined;
      const oldest = addDaysToDay(first.newest, 1);
      const newest = addDaysToDay(oldest, PAGE_SIZE_DAYS);
      return { oldest, newest: newest > today ? today : newest };
    },
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: CACHE.HOUR, // 1 hour - keep in memory for navigation
    maxPages: 10,
    enabled: isAuthenticated && !!athleteId,
  });

  // All activities flattened from loaded pages
  const allActivities = useMemo(() => {
    if (!query.data?.pages) return [];
    return query.data.pages.flat();
  }, [query.data]);

  return {
    ...query,
    allActivities,
  };
}

/** Activities per page of a feed search. */
const SEARCH_PAGE_SIZE = 30;

interface FeedSearchPage {
  activities: FeedCard[];
  matchedCount: number;
  hasMore: boolean;
}

function readSearchPage(
  needle: string,
  groups: ReadonlySet<FeedGroup>,
  range: FeedRange | null,
  offset: number,
  limit: number
): FeedSearchPage | undefined {
  const page = getEngine()?.searchFeedCards({
    needle,
    sportFamilies: [...groups].map(feedSportGroup),
    ...(range && {
      oldestTs: dayStartEpochSeconds(range.oldest),
      newestTs: dayEndEpochSeconds(range.newest),
    }),
    offset,
    limit,
  });
  return (
    page && {
      activities: page.cards as FeedCard[],
      matchedCount: page.matchedCount,
      hasMore: page.hasMore,
    }
  );
}

/**
 * The feed while a search or a sport chip is on, read over every stored
 * activity rather than the windows the unfiltered feed has paged in. Those
 * hold a few months at most, so filtering them answered "no match" for any
 * activity older than what happened to be loaded.
 *
 * A date range narrows the read to its inclusive days; none reads the whole
 * library. A range on its own is listed by the range read, so this reads only
 * the engine's count of it, with no bodies.
 *
 * Disabled with no filter, when the windowed feed is the read.
 */
export function useFeedSearch(
  searchText: string,
  groups: ReadonlySet<FeedGroup>,
  range: FeedRange | null = null
) {
  const athleteId = useAuthStore((s) => s.athleteId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const needle = searchText.trim();
  const searching = isFeedSearch({ searchText, groups });
  const countOnly = !searching && range !== null;
  const limit = countOnly ? 0 : SEARCH_PAGE_SIZE;
  const enabled = isAuthenticated && !!athleteId && (searching || countOnly);

  useEngineChannel('activities', queryKeys.activities.search.all);

  const query = useInfiniteQuery<FeedSearchPage, Error>({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.activities.search.byFilter(
      athleteId ?? 'anon',
      needle,
      [...groups].sort(),
      range
    ),
    queryFn: ({ pageParam }) => {
      const page = readSearchPage(needle, groups, range, pageParam as number, limit);
      if (!page) throw new Error('The activity library is not open');
      return page;
    },
    // The engine answers synchronously, so the first page is read with the
    // render that asked for it. Waiting a tick left the list empty for a frame
    // on every keystroke, which remounted the header the search box sits in
    // and took its focus.
    initialData: () => {
      if (!enabled) return undefined;
      const first = readSearchPage(needle, groups, range, 0, limit);
      return first && { pages: [first], pageParams: [0] };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      !countOnly && lastPage.hasMore ? (lastPageParam as number) + SEARCH_PAGE_SIZE : undefined,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: CACHE.SHORT,
    enabled,
  });

  const activities = useMemo(
    () => query.data?.pages.flatMap((page) => page.activities) ?? [],
    [query.data]
  );

  return {
    ...query,
    activities,
    matchedCount: query.data?.pages[0]?.matchedCount ?? 0,
  };
}

export function useActivity(id: string) {
  const queryKey = queryKeys.activities.detail(id);

  const query = useQuery<ActivityRecord | null>({
    ...LOCAL_READ_QUERY,
    queryKey,
    queryFn: () => readActivityRecord(id),
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    // A closed detail is let go within minutes. SQLite is the source and the
    // re-read is sub-second, so an hour of browsing must not pin every body it
    // opened. The window is long enough for a step to a neighbour and back.
    gcTime: CACHE.SHORT,
    enabled: !!id,
  });

  // The list sync stores a lighter body for every activity. Opening one asks
  // for the full detail, which replaces that row in place. Presence comes from
  // the query's own result rather than a second read: the row existing is not
  // proof the detail landed, so the engine says which form it holds.
  // A push can name an activity the library has never held, so this is not
  // only the "replace the light row with the full detail" case: the fetch is
  // the only thing that puts the activity on screen at all. The wait is
  // returned with it, because a screen opened from a notification has to be
  // able to say the download failed rather than spin on an announcement that
  // is never coming.
  const wait = useEngineBody(
    query.data?.isDetail ?? false,
    () => getEngine()?.syncActivityDetail(id),
    queryKey,
    // `undefined` is the query not having run, which is not the same as
    // nothing being stored, and asking then would fire before the read.
    !!id && query.data !== undefined
  );

  return { ...query, bodyStatus: wait.status, retryBody: wait.retry };
}

export function useActivityStreams(id: string) {
  const queryKey = queryKeys.activities.streams(id);

  // The query is the only reader of the stored body, the shape
  // `useActivityIntervals` uses below. A probe in the render body ran the
  // whole read again on every re-render, which during a chart scrub is a
  // `JSON.parse` of 100-500 KB and a SQLite write per frame, for a boolean
  // the query's own result already carries.
  const query = useQuery<ActivityStreams | null>({
    ...LOCAL_READ_QUERY,
    queryKey,
    queryFn: () => readStreams(id, DETAIL_STREAM_TYPES),
    // Streams NEVER change - infinite staleTime prevents refetching
    staleTime: Infinity,
    // Streams are the largest payloads (100-500KB each), so they go on the
    // same short window as the body they belong to. Re-decoding from the
    // engine on revisit is cheap.
    gcTime: CACHE.SHORT,
    enabled: !!id,
  });
  const wait = useEngineBody(
    query.data != null,
    () => requestStreams(id, DETAIL_STREAM_TYPES),
    queryKey,
    // `undefined` is the query not having run, which is not the same as
    // nothing being stored, and asking then would fire before the read.
    !!id && query.data !== undefined
  );

  return {
    ...query,
    data: query.data ?? EMPTY_STREAMS,
    isDownloaded: query.data != null,
    bodyStatus: wait.status,
    retryBody: wait.retry,
  };
}

export function useActivityDetailStreams(id: string) {
  const streams = useActivityStreams(id);
  useTrackWaitTimeline(streams.isSuccess, streams.isDownloaded);
  const coordinates = useDetailCoordinates(id, streams.data?.latlng, streams.isLoading);
  return { ...streams, coordinates };
}

// The open is decided once the stored read has run, since `isDownloaded` is
// also false while that read is pending.
function useTrackWaitTimeline(readDone: boolean, downloaded: boolean) {
  const wait = useRef<TrackWait | null | undefined>(undefined);
  useEffect(() => {
    if (!readDone || wait.current !== undefined) return;
    wait.current = freshLoginTimeline.openTrack(downloaded);
  }, [readDone, downloaded]);
  useEffect(() => {
    if (downloaded) wait.current?.landed();
  }, [downloaded]);
  useEffect(() => () => wait.current?.abandoned(), []);
}

/** Stable series value while the separately reported download is pending. */
const EMPTY_STREAMS = {} as ActivityStreams;

/**
 * What an empty lap list means. `pending` is every kind of ignorance: the read
 * has not run, the body was never fetched, and a stored body that will not
 * parse, which re-asking is what fixes.
 */
export type IntervalsOutcome = 'loaded' | 'empty' | 'pending';

export function useActivityIntervals(id: string) {
  const queryKey = queryKeys.activities.intervals(id);

  // The query is the only reader of the stored laps. `null` is "never
  // fetched", which is the cue to ask Rust for them.
  const query = useQuery<ActivityInterval[] | null>({
    ...LOCAL_READ_QUERY,
    queryKey,
    queryFn: () => getEngine()?.getActivityIntervals(id)?.intervals ?? null,
    // Intervals never change
    staleTime: Infinity,
    // Held for as long as the body they belong to, and no longer.
    gcTime: CACHE.SHORT,
    enabled: !!id,
  });
  const wait = useEngineBody(
    query.data !== null,
    () => getEngine()?.syncActivityIntervals(id),
    queryKey,
    !!id && query.data !== undefined
  );

  // A body never fetched and a ride with no laps both handed back an empty
  // list, so the section drew the same nothing for a lapless steady ride and
  // for one the sync has not reached.
  return {
    ...query,
    data: query.data ?? EMPTY_INTERVALS,
    outcome: outcomeOf(query.data),
    bodyStatus: wait.status,
    retryBody: wait.retry,
  };
}

function outcomeOf(stored: ActivityInterval[] | null | undefined): IntervalsOutcome {
  if (!stored) return 'pending';
  return stored.length > 0 ? 'loaded' : 'empty';
}

/** Rendered as "no intervals" rather than an error while the fetch is in flight. */
const EMPTY_INTERVALS: ActivityInterval[] = [];

/**
 * The feed over one date range, newest first in pages that stay inside it.
 *
 * Nothing is read while `range` is null. The range is the whole question, so
 * the pages are keyed by it and a new range starts from its newest day.
 */
export function useRangeActivities(range: FeedRange | null) {
  const athleteId = useAuthStore((s) => s.athleteId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEngineChannel('activities', queryKeys.activities.range.all);

  const query = useInfiniteQuery<FeedCard[], Error>({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.activities.range.byRange(
      athleteId ?? 'anon',
      range?.oldest ?? '',
      range?.newest ?? ''
    ),
    queryFn: ({ pageParam }) => {
      const { oldest, newest } = pageParam as FeedRange;
      requestActivityWindow(oldest, newest);
      return readFeedCards(oldest, newest);
    },
    initialPageParam: range ? firstRangePage(range) : { oldest: '', newest: '' },
    getNextPageParam: (_lastPage, _allPages, lastPageParam) =>
      range ? olderRangePage(range, lastPageParam as FeedRange) : undefined,
    staleTime: Infinity,
    gcTime: CACHE.HOUR,
    enabled: isAuthenticated && !!athleteId && range !== null,
  });

  const allActivities = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);

  return { ...query, allActivities };
}
