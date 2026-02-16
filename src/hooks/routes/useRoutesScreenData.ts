/**
 * Single-FFI hook for the Routes screen with pagination support.
 * Returns everything the screen needs (groups with polylines, sections with polylines,
 * counts, date range) from one Rust call instead of 50+.
 *
 * Supports infinite scroll: call loadMoreGroups/loadMoreSections to fetch the next page.
 * On engine refresh events, resets to the first page.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from './useRouteEngine';
import type { RoutesScreenData, GroupWithPolyline, SectionWithPolyline } from 'veloqrs';

const DEFAULT_PAGE_SIZE = 50;

interface PaginatedRoutesData extends RoutesScreenData {
  /** Accumulated groups across all loaded pages */
  groups: GroupWithPolyline[];
  /** Accumulated sections across all loaded pages */
  sections: SectionWithPolyline[];
  /** Whether route groups need recomputation */
  groupsDirty: boolean;
}

interface UseRoutesScreenDataResult {
  data: PaginatedRoutesData | null;
  loadMoreGroups: () => void;
  loadMoreSections: () => void;
  hasMoreGroups: boolean;
  hasMoreSections: boolean;
}

export function useRoutesScreenData(opts?: {
  groupLimit?: number;
  sectionLimit?: number;
}): UseRoutesScreenDataResult {
  const groupLimit = opts?.groupLimit ?? DEFAULT_PAGE_SIZE;
  const sectionLimit = opts?.sectionLimit ?? DEFAULT_PAGE_SIZE;

  // Subscribe to engine events — triggers re-render when data changes
  const trigger = useEngineSubscription(['groups', 'sections', 'activities']);

  // Re-query on screen focus — handles missed notifications during enableFreeze.
  // When the Routes tab is frozen, React state updates from engine notifications
  // are dropped. Bumping focusTrigger on focus ensures fresh data.
  const [focusTrigger, setFocusTrigger] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setFocusTrigger((t) => t + 1);
    }, [])
  );

  // Track pagination offsets
  const [groupOffset, setGroupOffset] = useState(0);
  const [sectionOffset, setSectionOffset] = useState(0);

  // Accumulated data across pages
  const groupsRef = useRef<GroupWithPolyline[]>([]);
  const sectionsRef = useRef<SectionWithPolyline[]>([]);
  const hasMoreGroupsRef = useRef(false);
  const hasMoreSectionsRef = useRef(false);

  // Loading guards — prevent onEndReached from firing multiple times between renders
  const isLoadingGroupsRef = useRef(false);
  const isLoadingSectionsRef = useRef(false);

  // Track the trigger value that last reset the refs
  const lastTriggerRef = useRef(trigger);

  // Track last successful result for error recovery
  const lastResultRef = useRef<PaginatedRoutesData | null>(null);

  // Combined trigger — engine events OR tab focus
  const combinedTrigger = trigger + focusTrigger;

  // Reset pagination on engine events (new sync, etc.)
  useEffect(() => {
    if (combinedTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = combinedTrigger;
      groupsRef.current = [];
      sectionsRef.current = [];
      isLoadingGroupsRef.current = false;
      isLoadingSectionsRef.current = false;
      setGroupOffset(0);
      setSectionOffset(0);
    }
  }, [combinedTrigger]);

  // Compute data from engine
  const data = useMemo(() => {
    try {
      const engine = getRouteEngine();
      if (!engine) return lastResultRef.current;

      const result = engine.getRoutesScreenData(
        groupLimit,
        groupOffset,
        sectionLimit,
        sectionOffset
      );
      if (!result) return lastResultRef.current;

      // Accumulate groups
      if (groupOffset === 0) {
        groupsRef.current = result.groups;
      } else {
        const existingGroupIds = new Set(groupsRef.current.map((g) => g.groupId));
        for (const g of result.groups) {
          if (!existingGroupIds.has(g.groupId)) {
            groupsRef.current.push(g);
          }
        }
      }

      // Accumulate sections
      if (sectionOffset === 0) {
        sectionsRef.current = result.sections;
      } else {
        const existingSectionIds = new Set(sectionsRef.current.map((s) => s.id));
        for (const s of result.sections) {
          if (!existingSectionIds.has(s.id)) {
            sectionsRef.current.push(s);
          }
        }
      }

      hasMoreGroupsRef.current = result.hasMoreGroups;
      hasMoreSectionsRef.current = result.hasMoreSections;

      const data = {
        activityCount: result.activityCount,
        groupCount: result.groupCount,
        sectionCount: result.sectionCount,
        oldestDate: result.oldestDate,
        newestDate: result.newestDate,
        groups: [...groupsRef.current],
        sections: [...sectionsRef.current],
        hasMoreGroups: result.hasMoreGroups,
        hasMoreSections: result.hasMoreSections,
        groupsDirty: result.groupsDirty ?? false,
      } as PaginatedRoutesData;

      lastResultRef.current = data;
      return data;
    } catch {
      // On error, stop pagination to prevent infinite loops
      hasMoreGroupsRef.current = false;
      hasMoreSectionsRef.current = false;
      return lastResultRef.current;
    } finally {
      // Always clear loading guards so next page can be requested
      isLoadingGroupsRef.current = false;
      isLoadingSectionsRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedTrigger, groupOffset, sectionOffset, groupLimit, sectionLimit]);

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
    loadMoreGroups,
    loadMoreSections,
    hasMoreGroups: hasMoreGroupsRef.current,
    hasMoreSections: hasMoreSectionsRef.current,
  };
}
