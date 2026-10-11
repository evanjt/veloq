/**
 * Single-FFI hook for the Routes screen with pagination support.
 * Returns everything the screen needs (groups with polylines, sections with polylines,
 * counts, date range) from one Rust call instead of 50+.
 *
 * Supports infinite scroll: call loadMoreGroups/loadMoreSections to fetch the next page.
 * On engine refresh events, resets to the first page.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { runWhenIdle } from '@/shared/async/runWhenIdle';
import { useFocusEffect } from 'expo-router';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from './useEngine';
import type {
  RoutesScreenData,
  GroupWithPolyline,
  SectionWithPolyline,
  SectionHiddenFilters,
} from 'veloqrs';
import { GroupSort, SectionSort } from 'veloqrs';
import type { LatLngShort } from '@/shared/geo/distance';
import {
  mergeHasMore,
  routesPageQuery,
  type RoutesPageKind,
} from '@/features/routes/lib/routesPageQuery';

const DEFAULT_PAGE_SIZE = 50;

interface PaginatedRoutesData extends RoutesScreenData {
  /** Accumulated groups across all loaded pages */
  groups: GroupWithPolyline[];
  /** Accumulated sections across all loaded pages */
  sections: SectionWithPolyline[];
  /** Whether route groups need recomputation */
  groupsDirty: boolean;
}

/** A failed read is its own state, so a screen never takes it for an empty library. */
export type RoutesScreenStatus = 'loading' | 'error' | 'loaded';

interface PageRead {
  data: PaginatedRoutesData | null;
  error: Error | null;
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

interface UseRoutesScreenDataResult {
  data: PaginatedRoutesData | null;
  status: RoutesScreenStatus;
  /** The last read's failure, kept beside any earlier page so a screen can tell it apart from empty. */
  error: Error | null;
  /** Reads the first page again. */
  retry: () => void;
  loadMoreGroups: () => void;
  loadMoreSections: () => void;
  hasMoreGroups: boolean;
  hasMoreSections: boolean;
}

const NO_FILTERS: SectionHiddenFilters = {
  hideCustom: false,
  hideAuto: false,
  hideDisabled: false,
  hideUnaccepted: false,
};

/**
 * The head of the list, read with no accumulator behind it.
 *
 * The paging path in the hook appends each page onto refs, which a render must
 * not touch. At offset zero there is nothing to append to, so the first page can
 * be read while rendering and the refs catch up in an effect.
 *
 * Measured on the S22 with a standalone `aarch64-linux-android` engine binary
 * (no app build) against its own library (1105 activities, 91 groups, 63
 * sections): 0.89 ms warm, 1.44 ms on the first call after load, against a
 * 100 ms mount budget. `benches/routes_screen_read_cost.rs` is the bench.
 */
function readFirstPage(query: {
  groupLimit: number;
  sectionLimit: number;
  groupSort: GroupSort;
  groupSearch: string;
  sectionSort: SectionSort;
  sectionSearch: string;
  sectionFilters: SectionHiddenFilters;
  groupSportType?: string | undefined;
  sectionSportType?: string | undefined;
  userLat: number;
  userLng: number;
}): PageRead {
  try {
    const engine = getEngine();
    if (!engine) return { data: null, error: null };

    const result = engine.getRoutesScreenData({
      groupLimit: query.groupLimit,
      groupOffset: 0,
      sectionLimit: query.sectionLimit,
      sectionOffset: 0,
      minGroupActivityCount: 2,
      groupSort: query.groupSort,
      groupSearch: query.groupSearch,
      sectionSort: query.sectionSort,
      sectionSearch: query.sectionSearch,
      sectionFilters: query.sectionFilters,
      ...(query.groupSportType !== undefined && { groupSportType: query.groupSportType }),
      ...(query.sectionSportType !== undefined && { sectionSportType: query.sectionSportType }),
      userLat: query.userLat,
      userLng: query.userLng,
    });
    if (!result) return { data: null, error: null };

    const data = {
      activityCount: result.activityCount,
      groupCount: result.groupCount,
      filteredGroupCount: result.filteredGroupCount,
      filteredSectionCount: result.filteredSectionCount,
      sectionCount: result.sectionCount,
      oldestDate: result.oldestDate,
      newestDate: result.newestDate,
      unacceptedAutoCount: result.unacceptedAutoCount,
      acceptedAutoCount: result.acceptedAutoCount,
      customCount: result.customCount,
      retiredCount: result.retiredCount,
      availableSportTypes: result.availableSportTypes,
      groups: result.groups,
      sections: result.sections,
      hasMoreGroups: result.hasMoreGroups,
      hasMoreSections: result.hasMoreSections,
      groupsDirty: result.groupsDirty ?? false,
    } as PaginatedRoutesData;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: asError(e) };
  }
}

export function useRoutesScreenData(opts?: {
  groupLimit?: number;
  sectionLimit?: number;
  groupSort?: GroupSort;
  groupSearch?: string;
  sectionSort?: SectionSort;
  sectionSearch?: string;
  sectionFilters?: SectionHiddenFilters;
  groupSportType?: string | undefined;
  sectionSportType?: string | undefined;
  userLocation?: LatLngShort | null;
}): UseRoutesScreenDataResult {
  const groupLimit = opts?.groupLimit ?? DEFAULT_PAGE_SIZE;
  const sectionLimit = opts?.sectionLimit ?? DEFAULT_PAGE_SIZE;
  const groupSort = opts?.groupSort ?? GroupSort.Activities;
  const groupSearch = opts?.groupSearch ?? '';
  const sectionSort = opts?.sectionSort ?? SectionSort.Visits;
  const sectionSearch = opts?.sectionSearch ?? '';
  const sectionFilters = opts?.sectionFilters ?? NO_FILTERS;
  const groupSportType = opts?.groupSportType;
  const sectionSportType = opts?.sectionSportType;
  const userLat = opts?.userLocation?.lat ?? Number.NaN;
  const userLng = opts?.userLocation?.lng ?? Number.NaN;

  // Subscribe to engine events - triggers re-render when data changes
  const trigger = useEngineSubscription(['groups', 'sections', 'activities']);

  // Re-query on screen focus - handles missed notifications during enableFreeze.
  // When the Routes tab is frozen, React state updates from engine notifications
  // are dropped. dirtyRef tracks whether the engine trigger advanced while frozen;
  // useFocusEffect only bumps focusTrigger when there is actually new data.
  const [focusTrigger, setFocusTrigger] = useState(0);
  const dirtyRef = useRef(false);
  const lastSeenTriggerRef = useRef(trigger);
  useEffect(() => {
    if (trigger !== lastSeenTriggerRef.current) {
      dirtyRef.current = true;
      lastSeenTriggerRef.current = trigger;
    }
  }, [trigger]);
  useFocusEffect(
    useCallback(() => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setFocusTrigger((t) => t + 1);
      }
    }, [])
  );

  const [retryTick, setRetryTick] = useState(0);

  // Track pagination offsets
  const [groupOffset, setGroupOffset] = useState(0);
  const [sectionOffset, setSectionOffset] = useState(0);

  // Accumulated data across pages
  const groupsRef = useRef<GroupWithPolyline[]>([]);
  const sectionsRef = useRef<SectionWithPolyline[]>([]);
  const hasMoreGroupsRef = useRef(false);
  const hasMoreSectionsRef = useRef(false);

  // Loading guards - prevent onEndReached from firing multiple times between renders
  const isLoadingGroupsRef = useRef(false);
  const isLoadingSectionsRef = useRef(false);

  // Track the trigger value that last reset the refs
  const lastTriggerRef = useRef(trigger);
  const lastQueryConfigRef = useRef('');

  // Track last successful result for error recovery
  const lastResultRef = useRef<PaginatedRoutesData | null>(null);

  // Combined trigger - engine events OR tab focus
  const combinedTrigger = trigger + focusTrigger;

  // Every part of the query that changes what a page holds resets the paging,
  // because an accumulated page taken under a different order or search is
  // not the head of this one.
  const queryConfig = [
    combinedTrigger,
    groupLimit,
    sectionLimit,
    groupSort,
    groupSearch,
    sectionSort,
    sectionSearch,
    sectionFilters.hideCustom ? 1 : 0,
    sectionFilters.hideAuto ? 1 : 0,
    sectionFilters.hideDisabled ? 1 : 0,
    sectionFilters.hideUnaccepted ? 1 : 0,
    groupSportType ?? '',
    sectionSportType ?? '',
    Number.isFinite(userLat) ? userLat.toFixed(6) : 'nan',
    Number.isFinite(userLng) ? userLng.toFixed(6) : 'nan',
  ].join(':');

  // Reset pagination on engine events (new sync, etc.)
  useEffect(() => {
    if (combinedTrigger !== lastTriggerRef.current || queryConfig !== lastQueryConfigRef.current) {
      lastTriggerRef.current = combinedTrigger;
      lastQueryConfigRef.current = queryConfig;
      groupsRef.current = [];
      sectionsRef.current = [];
      isLoadingGroupsRef.current = false;
      isLoadingSectionsRef.current = false;
      setGroupOffset(0);
      setSectionOffset(0);
    }
  }, [combinedTrigger, queryConfig]);

  // Compute data from engine, accumulating the page onto the ones before it. Runs
  // when the thread is idle for every page after the first, which arrives while
  // the list is on screen and scrolling.
  const computeData = useCallback((): PageRead => {
    try {
      const engine = getEngine();
      if (!engine) return { data: lastResultRef.current, error: null };

      // A load-more raises its list's guard, so a read with one guard up pages
      // that list alone; the head, a reset or both at once reads both.
      const kind: RoutesPageKind =
        isLoadingGroupsRef.current === isLoadingSectionsRef.current
          ? 'both'
          : isLoadingGroupsRef.current
            ? 'groups'
            : 'sections';
      const result = engine.getRoutesScreenData({
        ...routesPageQuery(kind, { groupOffset, groupLimit, sectionOffset, sectionLimit }),
        minGroupActivityCount: 2,
        groupSort,
        groupSearch,
        sectionSort,
        sectionSearch,
        sectionFilters,
        ...(groupSportType !== undefined && { groupSportType }),
        ...(sectionSportType !== undefined && { sectionSportType }),
        userLat,
        userLng,
      });
      if (!result) return { data: lastResultRef.current, error: null };

      // Accumulate the list that was read; the other one was asked for no rows.
      if (kind === 'sections') {
        // Groups unchanged.
      } else if (groupOffset === 0) {
        groupsRef.current = result.groups;
      } else {
        const existingGroupIds = new Set(groupsRef.current.map((g) => g.groupId));
        for (const g of result.groups) {
          if (!existingGroupIds.has(g.groupId)) {
            groupsRef.current.push(g);
          }
        }
      }

      if (kind === 'groups') {
        // Sections unchanged.
      } else if (sectionOffset === 0) {
        sectionsRef.current = result.sections;
      } else {
        const existingSectionIds = new Set(sectionsRef.current.map((s) => s.id));
        for (const s of result.sections) {
          if (!existingSectionIds.has(s.id)) {
            sectionsRef.current.push(s);
          }
        }
      }

      const hasMore = mergeHasMore(kind, result, {
        hasMoreGroups: hasMoreGroupsRef.current,
        hasMoreSections: hasMoreSectionsRef.current,
      });
      hasMoreGroupsRef.current = hasMore.hasMoreGroups;
      hasMoreSectionsRef.current = hasMore.hasMoreSections;

      const data = {
        activityCount: result.activityCount,
        groupCount: result.groupCount,
        filteredGroupCount: result.filteredGroupCount,
        filteredSectionCount: result.filteredSectionCount,
        sectionCount: result.sectionCount,
        oldestDate: result.oldestDate,
        newestDate: result.newestDate,
        unacceptedAutoCount: result.unacceptedAutoCount,
        acceptedAutoCount: result.acceptedAutoCount,
        customCount: result.customCount,
        retiredCount: result.retiredCount,
        availableSportTypes: result.availableSportTypes,
        groups: [...groupsRef.current],
        sections: [...sectionsRef.current],
        hasMoreGroups: hasMore.hasMoreGroups,
        hasMoreSections: hasMore.hasMoreSections,
        groupsDirty: result.groupsDirty ?? false,
      } as PaginatedRoutesData;

      lastResultRef.current = data;
      return { data, error: null };
    } catch (e) {
      // On error, stop pagination to prevent infinite loops
      hasMoreGroupsRef.current = false;
      hasMoreSectionsRef.current = false;
      return { data: lastResultRef.current, error: asError(e) };
    } finally {
      // Always clear loading guards so next page can be requested
      isLoadingGroupsRef.current = false;
      isLoadingSectionsRef.current = false;
    }
  }, [
    groupOffset,
    sectionOffset,
    groupLimit,
    sectionLimit,
    groupSort,
    groupSearch,
    sectionSort,
    sectionSearch,
    sectionFilters,
    groupSportType,
    sectionSportType,
    userLat,
    userLng,
  ]);

  // What a read was asked: the query, its paging and the retry it answers. The
  // read effect skips a read whose key the current page already answers, which
  // is the mount after the first page read while rendering. The key goes on the
  // page when the read runs rather than when it is scheduled, so a cancelled
  // read is not taken for a finished one.
  const readKey = `${queryConfig}|${groupOffset}|${sectionOffset}|${retryTick}`;

  // The first page is read while rendering, so frame one already has it rather
  // than a skeleton the list used to fill from a summary read of its own. It
  // takes no accumulator with it: at offset zero the page IS the accumulation,
  // and a render that touches a ref is a render that can be discarded.
  const [read, setRead] = useState<PageRead & { answers: string | null }>(() => {
    const first = readFirstPage({
      groupLimit,
      sectionLimit,
      groupSort,
      groupSearch,
      sectionSort,
      sectionSearch,
      sectionFilters,
      groupSportType,
      sectionSportType,
      userLat,
      userLng,
    });
    // A page that landed answers the read the mount would otherwise repeat; a
    // failed or engine-less one is read again once idle.
    return { ...first, answers: first.data ? readKey : null };
  });

  // The accumulators catch up to that page once, off the render path, so the
  // next page appends to it rather than replacing it.
  const { data, error } = read;
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !data) return;
    seeded.current = true;
    groupsRef.current = [...data.groups];
    sectionsRef.current = [...data.sections];
    hasMoreGroupsRef.current = data.hasMoreGroups;
    hasMoreSectionsRef.current = data.hasMoreSections;
    lastResultRef.current = data;
  }, [data]);

  const answered = read.answers === readKey;
  useEffect(
    () =>
      answered ? undefined : runWhenIdle(() => setRead({ ...computeData(), answers: readKey })),
    [answered, readKey, computeData]
  );

  const retry = useCallback(() => {
    groupsRef.current = [];
    sectionsRef.current = [];
    isLoadingGroupsRef.current = false;
    isLoadingSectionsRef.current = false;
    setGroupOffset(0);
    setSectionOffset(0);
    setRetryTick((t) => t + 1);
  }, []);

  const loadMoreGroups = useCallback(() => {
    if (hasMoreGroupsRef.current && !isLoadingGroupsRef.current) {
      isLoadingGroupsRef.current = true;
      setGroupOffset((prev) => prev + groupLimit);
    }
  }, [groupLimit]);

  const loadMoreSections = useCallback(() => {
    if (hasMoreSectionsRef.current && !isLoadingSectionsRef.current) {
      isLoadingSectionsRef.current = true;
      setSectionOffset((prev) => prev + sectionLimit);
    }
  }, [sectionLimit]);

  return {
    data,
    status: data ? 'loaded' : error ? 'error' : 'loading',
    error,
    retry,
    loadMoreGroups,
    loadMoreSections,
    hasMoreGroups: data?.hasMoreGroups ?? false,
    hasMoreSections: data?.hasMoreSections ?? false,
  };
}
