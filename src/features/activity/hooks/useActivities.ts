import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { intervalsApi } from '@/api';
import { formatLocalDate } from '@/shared/format/format';
import { CACHE } from '@/shared/app/constants';
import { queryKeys } from '@/shared/query/queryKeys';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import type { Activity, IntervalsDTO } from '@/types';
import { useAuthStore } from '@/shared/app/AuthStore';

/** Local midnight for a YYYY-MM-DD day, as the epoch seconds the engine keys on. */
function dayStartTimestamp(day: string): number {
  return Math.floor(new Date(`${day}T00:00:00`).getTime() / 1000);
}

/** Local end-of-day, so an inclusive window really includes its last day. */
function dayEndTimestamp(day: string): number {
  return Math.floor(new Date(`${day}T23:59:59`).getTime() / 1000);
}

/**
 * Read stored activities over a date window, newest first. A body that will
 * not parse is dropped rather than surfaced as a half-populated card.
 */
function readActivities(oldest: string, newest: string): Activity[] {
  const engine = getRouteEngine();
  if (!engine?.getActivityBodies) return [];

  const out: Activity[] = [];
  for (const body of engine.getActivityBodies(dayStartTimestamp(oldest), dayEndTimestamp(newest))) {
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
 */
const requestedWindows = new Set<string>();

function requestActivityWindow(oldest: string, newest: string): void {
  const key = `${oldest}:${newest}`;
  if (requestedWindows.has(key)) return;
  const engine = getRouteEngine();
  if (!engine?.syncActivitiesWindow) return;
  requestedWindows.add(key);
  engine.syncActivitiesWindow(oldest, newest);
}

/** Forget requested windows so a new session re-fetches them. */
export function resetActivityWindowRequests(): void {
  requestedWindows.clear();
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

  useEffect(() => {
    if (!enabled || !athleteId) return;
    requestActivityWindow(queryOldest!, queryNewest!);
  }, [enabled, athleteId, queryOldest, queryNewest]);

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
      const nextEnd = new Date(pageParam.oldest);
      nextEnd.setDate(nextEnd.getDate() - 1);
      const nextStart = new Date(nextEnd);
      nextStart.setDate(nextStart.getDate() - PAGE_SIZE_DAYS);

      return {
        oldest: formatLocalDate(nextStart),
        newest: formatLocalDate(nextEnd),
      };
    },
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: CACHE.HOUR, // 1 hour - keep in memory for navigation
    maxPages: 10, // Evict old pages to prevent memory growth
    enabled: isAuthenticated && !!athleteId,
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
  return useQuery({
    queryKey: queryKeys.activities.detail(id),
    queryFn: () => intervalsApi.getActivity(id),
    // Single activity - cache for 1 hour, rarely changes
    staleTime: CACHE.HOUR,
    // GC after 4 hours to prevent memory bloat when viewing many activities
    gcTime: CACHE.HOUR * 4,
    enabled: !!id,
  });
}

export function useActivityStreams(id: string) {
  return useQuery({
    queryKey: queryKeys.activities.streams(id),
    queryFn: () =>
      intervalsApi.getActivityStreams(id, [
        'latlng',
        'altitude',
        'fixed_altitude',
        'heartrate',
        'watts',
        'cadence',
        'distance',
        'time',
        'velocity_smooth',
        'grade_smooth',
        'temp',
        'w_bal',
        'ga_velocity',
      ]),
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
  return useQuery<IntervalsDTO>({
    queryKey: queryKeys.activities.intervals(id),
    queryFn: () => intervalsApi.getActivityIntervals(id),
    // Intervals never change
    staleTime: Infinity,
    gcTime: CACHE.HOUR * 2,
    enabled: !!id,
  });
}
