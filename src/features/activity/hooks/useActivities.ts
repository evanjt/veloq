import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import { useCallback, useEffect, useMemo } from 'react';
import { hasDetailBody, readActivityBody } from '@/features/activity/lib/engineActivityBody';
import {
  DETAIL_STREAM_TYPES,
  readStreams,
  requestStreams,
} from '@/features/activity/lib/engineStreams';
import { formatLocalDate } from '@/shared/format/format';
import { addDaysToDay, dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';
import { CACHE } from '@/shared/app/constants';
import { queryKeys } from '@/shared/query/queryKeys';
import { hasStarted } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { useEngineBody } from '@/shared/native/engineBodies';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import type { Activity, ActivityDetail, ActivityStreams, IntervalsDTO } from '@/types';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useReconnect, useSyncSettled } from '@/shared/app/useRetryTriggers';
import { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
import { useDetailCoordinates } from './useDetailCoordinates';
import { feedSportGroup, type FeedGroup } from '../lib/feedActivityGroups';
import { firstRangePage, olderRangePage, type FeedRange } from '../lib/feedRange';

/**
 * Read stored activities over a date window, newest first. A body that will
 * not parse is dropped rather than surfaced as a half-populated card.
 */
function readActivities(oldest: string, newest: string): Activity[] {
  const engine = getEngine();
  if (!engine?.getActivityBodies) return [];
  return parseBodies(
    engine.getActivityBodies(dayStartEpochSeconds(oldest), dayEndEpochSeconds(newest))
  );
}

function parseBodies(bodies: readonly string[]): Activity[] {
  const out: Activity[] = [];
  for (const body of bodies) {
    try {
      out.push(JSON.parse(body) as Activity);
    } catch {
      // A body we cannot parse is a corrupt row, not an activity with no data.
    }
  }
  return out;
}

/**
 * Ask Rust to fill a window the default sync may not cover.
 *
 * The sync pulls a year on launch. The timeline slider and the infinite feed
 * both reach further back than that, so a window they open is asked for and
 * the engine event wakes the read when it lands.
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

  const askForWindow = useCallback(() => {
    if (!enabled || !athleteId) return;
    requestActivityWindow(queryOldest, queryNewest);
  }, [enabled, athleteId, queryOldest, queryNewest]);

  useEffect(askForWindow, [askForWindow]);

  // A window accepted while the connection was dropping may have fetched
  // nothing, and the mount effect never re-runs for an unchanged window.
  useReconnect(askForWindow);

  // The launch sync holds the exclusive slot for minutes and refuses every
  // window opened while it runs. Nothing else observes it letting go, so a
  // window asked for at launch would otherwise stay blank until the user went
  // offline and back. A window that landed meanwhile answers `NotOwed`.
  useSyncSettled(askForWindow);

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

/**
 * Page size for infinite scroll (in days)
 */
const PAGE_SIZE_DAYS = 30;

/**
 * Infinite scroll for activity feed.
 *
 * Stale-while-revalidate: cached activities show instantly on app open,
 * background refetch picks up new activities. Persisted to AsyncStorage
 * so the feed renders immediately on subsequent opens.
 */
export function useInfiniteActivities() {
  const athleteId = useAuthStore((s) => s.athleteId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: oldestActivityDate } = useOldestActivityDate();
  const oldestDay = oldestActivityDate ? formatLocalDate(oldestActivityDate) : null;

  useEngineChannel('activities', queryKeys.activities.infinite.all);

  const query = useInfiniteQuery<Activity[], Error>({
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
      return readActivities(oldest, newest);
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

  // A reconnect is the point where a window that came back empty is worth
  // asking for again. The refetch replays every loaded page through the
  // `queryFn`, and the engine decides which of them still owe a download.
  useReconnect(() => {
    void query.refetch();
  });

  // The launch sync refuses any page opened while it runs. Refetching replays
  // every loaded page through the queryFn, and the engine answers `NotOwed`
  // for the ones that landed, so only the refused windows are asked again.
  useSyncSettled(() => {
    void query.refetch();
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
  activities: Activity[];
  matchedCount: number;
  hasMore: boolean;
}

function readSearchPage(
  needle: string,
  groups: ReadonlySet<FeedGroup>,
  range: FeedRange | null,
  offset: number
): FeedSearchPage | undefined {
  const page = getEngine()?.searchActivityBodies({
    needle,
    sportGroups: [...groups].map(feedSportGroup),
    ...(range && {
      oldestTs: dayStartEpochSeconds(range.oldest),
      newestTs: dayEndEpochSeconds(range.newest),
    }),
    offset,
    limit: SEARCH_PAGE_SIZE,
  });
  return (
    page && {
      activities: parseBodies(page.bodies),
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
 * library.
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
  const enabled = isAuthenticated && !!athleteId && (needle.length > 0 || groups.size > 0);

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
      const page = readSearchPage(needle, groups, range, pageParam as number);
      if (!page) throw new Error('The activity library is not open');
      return page;
    },
    // The engine answers synchronously, so the first page is read with the
    // render that asked for it. Waiting a tick left the list empty for a frame
    // on every keystroke, which remounted the header the search box sits in
    // and took its focus.
    initialData: () => {
      if (!enabled) return undefined;
      const first = readSearchPage(needle, groups, range, 0);
      return first && { pages: [first], pageParams: [0] };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.hasMore ? (lastPageParam as number) + SEARCH_PAGE_SIZE : undefined,
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

  const query = useQuery<ActivityDetail | null>({
    ...LOCAL_READ_QUERY,
    queryKey,
    queryFn: () => {
      const stored = readActivityBody(id);
      return (stored as ActivityDetail | null) ?? null;
    },
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
  // proof the detail landed, so it is read for the one field only the detail
  // endpoint returns.
  // A push can name an activity the library has never held, so this is not
  // only the "replace the light row with the full detail" case: the fetch is
  // the only thing that puts the activity on screen at all. The wait is
  // returned with it, because a screen opened from a notification has to be
  // able to say the download failed rather than spin on an announcement that
  // is never coming.
  const wait = useEngineBody(
    hasDetailBody(query.data),
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
  const coordinates = useDetailCoordinates(id, streams.data?.latlng, streams.isLoading);
  return { ...streams, coordinates };
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

  // The query is the only reader of the stored body. `null` is "never
  // fetched", which is the cue to ask Rust for it.
  const query = useQuery<IntervalsDTO | null>({
    ...LOCAL_READ_QUERY,
    queryKey,
    queryFn: () => {
      const stored = getEngine()?.getIntervalBody(id);
      if (!stored) return null;
      try {
        return JSON.parse(stored) as IntervalsDTO;
      } catch {
        // empty-on-error: a JSON.parse of a stored body, not an engine read. A row that will
        // not parse is corrupt, not a ride with no laps, and `null` is what asks Rust for it again.
        return null;
      }
    },
    // Intervals never change
    staleTime: Infinity,
    // Held for as long as the body they belong to, and no longer.
    gcTime: CACHE.SHORT,
    enabled: !!id,
  });
  useEngineBody(
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
  };
}

function outcomeOf(stored: IntervalsDTO | null | undefined): IntervalsOutcome {
  if (!stored) return 'pending';
  return (stored.icu_intervals?.length ?? 0) > 0 ? 'loaded' : 'empty';
}

/** Rendered as "no intervals" rather than an error while the fetch is in flight. */
const EMPTY_INTERVALS = { icu_intervals: [], icu_groups: [] } as unknown as IntervalsDTO;

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

  const query = useInfiniteQuery<Activity[], Error>({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.activities.range.byRange(
      athleteId ?? 'anon',
      range?.oldest ?? '',
      range?.newest ?? ''
    ),
    queryFn: ({ pageParam }) => {
      const { oldest, newest } = pageParam as FeedRange;
      requestActivityWindow(oldest, newest);
      return readActivities(oldest, newest);
    },
    initialPageParam: range ? firstRangePage(range) : { oldest: '', newest: '' },
    getNextPageParam: (_lastPage, _allPages, lastPageParam) =>
      range ? olderRangePage(range, lastPageParam as FeedRange) : undefined,
    staleTime: Infinity,
    gcTime: CACHE.HOUR,
    enabled: isAuthenticated && !!athleteId && range !== null,
  });

  useReconnect(() => {
    if (range) void query.refetch();
  });
  useSyncSettled(() => {
    if (range) void query.refetch();
  });

  const allActivities = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);

  return { ...query, allActivities };
}
