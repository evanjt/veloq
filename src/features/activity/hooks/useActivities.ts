import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import {
  DETAIL_STREAM_TYPES,
  readStreams,
  requestStreams,
} from '@/features/activity/lib/engineStreams';
import { formatLocalDate } from '@/shared/format/format';
import { addDaysToDay, dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';
import { CACHE } from '@/shared/app/constants';
import { queryKeys } from '@/shared/query/queryKeys';
import { getEngine } from '@/shared/native/engine';
import { useEngineBody } from '@/shared/native/engineBodies';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import type { Activity, ActivityDetail, IntervalsDTO } from '@/types';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useReconnect, useSyncSettled } from '@/shared/app/useRetryTriggers';

/**
 * Read stored activities over a date window, newest first. A body that will
 * not parse is dropped rather than surfaced as a half-populated card.
 */
function readActivities(oldest: string, newest: string): Activity[] {
  const engine = getEngine();
  if (!engine?.getActivityBodies) return [];

  const out: Activity[] = [];
  for (const body of engine.getActivityBodies(
    dayStartEpochSeconds(oldest),
    dayEndEpochSeconds(newest)
  )) {
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
 * both reach further back than that, so a window they open is requested once
 * and the engine event wakes the read when it lands.
 *
 * Only an accepted job is remembered. `syncActivitiesWindow` returns false
 * whenever the exclusive sync slot is held, which the launch sync holds for
 * minutes, and a key recorded for a job that never ran leaves that window
 * blank for the life of the process.
 */
const requestedWindows = new Set<string>();

function windowKey(oldest: string, newest: string): string {
  return `${oldest}:${newest}`;
}

function requestActivityWindow(oldest: string, newest: string): void {
  if (requestedWindows.has(windowKey(oldest, newest))) return;
  const engine = getEngine();
  if (!engine?.syncActivitiesWindow) return;
  try {
    if (engine.syncActivitiesWindow(oldest, newest)) {
      requestedWindows.add(windowKey(oldest, newest));
    }
  } catch {
    // A throw is a settled failure, so the key stays free for the next ask.
  }
}

/** Forget requested windows so a new session re-fetches them. */
export function resetActivityWindowRequests(): void {
  requestedWindows.clear();
}

/** Forget one window, so the next ask reaches the engine again. */
function forgetActivityWindow(oldest: string, newest: string): void {
  requestedWindows.delete(windowKey(oldest, newest));
}

interface UseActivitiesOptions {
  /** Number of days to fetch (from today backwards) */
  days?: number;
  /** Start date (YYYY-MM-DD) - overrides days */
  oldest?: string;
  /** End date (YYYY-MM-DD) - defaults to today */
  newest?: string;
  /** Include additional stats fields (eFTP, zone times) - use for performance page */
  includeStats?: boolean;
  /** Whether to enable the query (default: true) */
  enabled?: boolean;
}

/**
 * Standard activities hook for fixed date ranges.
 * Use this for specific date range queries (e.g., stats page, wellness).
 */
export function useActivities(options: UseActivitiesOptions = {}) {
  const { days, oldest, newest, includeStats = false, enabled = true } = options;
  const athleteId = useAuthStore((s) => s.athleteId);

  // Calculate date range
  let queryOldest = oldest;
  let queryNewest = newest;

  if (!oldest) {
    const today = new Date();
    const daysAgo = new Date(today);
    daysAgo.setDate(daysAgo.getDate() - (days || 30));
    queryOldest = formatLocalDate(daysAgo);
    queryNewest = newest || formatLocalDate(today);
  }

  useEngineChannel('activities', queryKeys.activities.all);

  const askForWindow = useCallback(() => {
    if (!enabled || !athleteId) return;
    requestActivityWindow(queryOldest!, queryNewest!);
  }, [enabled, athleteId, queryOldest, queryNewest]);

  useEffect(askForWindow, [askForWindow]);

  // A window accepted while the connection was dropping may have fetched
  // nothing, and the mount effect never re-runs for an unchanged window.
  useReconnect(() => {
    if (!enabled || !athleteId) return;
    forgetActivityWindow(queryOldest!, queryNewest!);
    askForWindow();
  });

  // The launch sync holds the exclusive slot for minutes and refuses every
  // window opened while it runs. Nothing else observes it letting go, so a
  // window asked for at launch would otherwise stay blank until the user went
  // offline and back. An accepted window is already recorded, so this is a
  // no-op for it.
  useSyncSettled(askForWindow);

  return useQuery<Activity[]>({
    queryKey: queryKeys.activities.list(
      athleteId ?? 'anon',
      queryOldest!,
      queryNewest!,
      includeStats
    ),
    queryFn: () => readActivities(queryOldest!, queryNewest!),
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
export function useInfiniteActivities(options: { includeStats?: boolean } = {}) {
  const { includeStats = false } = options;
  const athleteId = useAuthStore((s) => s.athleteId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEngineChannel('activities', queryKeys.activities.infinite.all);

  const query = useInfiniteQuery<Activity[], Error>({
    queryKey: queryKeys.activities.infinite.byAthlete(athleteId ?? 'anon', includeStats),
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
      // An empty page no longer means "end of history": the window may simply
      // not be fetched yet. Paging stops on the page cap instead.
      const pageParam = lastPageParam as { oldest: string };
      const nextEnd = addDaysToDay(pageParam.oldest, -1);

      return {
        oldest: addDaysToDay(nextEnd, -PAGE_SIZE_DAYS),
        newest: nextEnd,
      };
    },
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: CACHE.HOUR, // 1 hour - keep in memory for navigation
    maxPages: 10, // Evict old pages to prevent memory growth
    enabled: isAuthenticated && !!athleteId,
  });

  // The pages already loaded asked for their windows once. A reconnect is the
  // point where a window that came back empty is worth asking for again.
  useReconnect(() => {
    resetActivityWindowRequests();
    void query.refetch();
  });

  // The launch sync refuses any page opened while it runs. Refetching replays
  // every loaded page through the queryFn, which re-asks only the windows that
  // were refused, so no reset is wanted here.
  useSyncSettled(() => {
    void query.refetch();
  });

  // All activities flattened from loaded pages
  const allActivities = useMemo(() => {
    if (!query.data?.pages) return [];
    return query.data.pages.flat();
  }, [query.data?.pages]);

  return {
    ...query,
    allActivities,
  };
}

export function useActivity(id: string) {
  const queryKey = queryKeys.activities.detail(id);

  // The list sync stores a lighter body for every activity. Opening one asks
  // for the full detail, which replaces that row in place.
  useEngineBody(false, () => getEngine()?.syncActivityDetail(id), queryKey, !!id);

  return useQuery<ActivityDetail | null>({
    queryKey,
    queryFn: () => {
      const stored = readActivityBody(id);
      return (stored as ActivityDetail | null) ?? null;
    },
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    // GC after 4 hours to prevent memory bloat when viewing many activities
    gcTime: CACHE.HOUR * 4,
    enabled: !!id,
  });
}

/** The stored body for one activity, from the window that contains its day. */
function readActivityBody(id: string): Activity | null {
  const engine = getEngine();
  if (!engine?.getActivityBodies || !id) return null;
  // The store is keyed by id but queried by window, so scan the widest range
  // the app ever shows. The table holds one row per activity, not per day.
  for (const body of engine.getActivityBodies(0, Math.floor(Date.now() / 1000) + 86400)) {
    try {
      const parsed = JSON.parse(body) as Activity;
      if (parsed.id === id) return parsed;
    } catch {
      // Skip a corrupt row rather than failing the lookup.
    }
  }
  return null;
}

export function useActivityStreams(id: string) {
  const queryKey = queryKeys.activities.streams(id);

  const stored = id ? readStreams(id, DETAIL_STREAM_TYPES) : null;
  useEngineBody(stored !== null, () => requestStreams(id, DETAIL_STREAM_TYPES), queryKey, !!id);

  return useQuery({
    queryKey,
    queryFn: () => readStreams(id, DETAIL_STREAM_TYPES) ?? {},
    // Streams NEVER change - infinite staleTime prevents refetching
    staleTime: Infinity,
    // Streams are the largest payloads (100-500KB each). GC them sooner so
    // browsing many activities in one session doesn't pin them all in memory;
    // re-decoding from the engine on revisit is cheap.
    gcTime: CACHE.MEDIUM,
    enabled: !!id,
  });
}

export function useActivityIntervals(id: string) {
  const queryKey = queryKeys.activities.intervals(id);

  // The query is the only reader of the stored body. `null` is "never
  // fetched", which is the cue to ask Rust for it.
  const query = useQuery<IntervalsDTO | null>({
    queryKey,
    queryFn: () => {
      const stored = getEngine()?.getIntervalBody(id);
      if (!stored) return null;
      try {
        return JSON.parse(stored) as IntervalsDTO;
      } catch {
        return EMPTY_INTERVALS;
      }
    },
    // Intervals never change
    staleTime: Infinity,
    gcTime: CACHE.HOUR * 2,
    enabled: !!id,
  });
  useEngineBody(
    query.data !== null,
    () => getEngine()?.syncActivityIntervals(id),
    queryKey,
    !!id && query.data !== undefined
  );

  return { ...query, data: query.data ?? EMPTY_INTERVALS };
}

/** Rendered as "no intervals" rather than an error while the fetch is in flight. */
const EMPTY_INTERVALS = { icu_intervals: [], icu_groups: [] } as unknown as IntervalsDTO;
