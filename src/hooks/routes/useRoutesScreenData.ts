/**
 * Single-FFI hook for the Routes screen with pagination support.
 * Returns everything the screen needs (groups with polylines, sections with polylines,
 * counts, date range) from one Rust call instead of 50+.
 *
 * Supports infinite scroll: call loadMoreGroups/loadMoreSections to fetch the next page.
 * On engine refresh events, resets to the first page.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from './useRouteEngine';
import type { RoutesScreenData, GroupWithPolyline, SectionWithPolyline } from 'veloqrs';

const DEFAULT_PAGE_SIZE = 20;

interface PaginatedRoutesData extends RoutesScreenData {
  /** Accumulated groups across all loaded pages */
  groups: GroupWithPolyline[];
  /** Accumulated sections across all loaded pages */
  sections: SectionWithPolyline[];
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

  // Track pagination offsets
  const [groupOffset, setGroupOffset] = useState(0);
  const [sectionOffset, setSectionOffset] = useState(0);

  // Accumulated data across pages
  const groupsRef = useRef<GroupWithPolyline[]>([]);
  const sectionsRef = useRef<SectionWithPolyline[]>([]);
  const hasMoreGroupsRef = useRef(false);
  const hasMoreSectionsRef = useRef(false);

  // Track the trigger value that last reset the refs
  const lastTriggerRef = useRef(trigger);

  // Reset pagination on engine events (new sync, etc.)
  useEffect(() => {
    if (trigger !== lastTriggerRef.current) {
      lastTriggerRef.current = trigger;
      groupsRef.current = [];
      sectionsRef.current = [];
      setGroupOffset(0);
      setSectionOffset(0);
    }
  }, [trigger]);

  // Compute data from engine
  const data = useMemo(() => {
    try {
      const engine = getRouteEngine();
      if (!engine) return null;

      const result = engine.getRoutesScreenData(
        groupLimit,
        groupOffset,
        sectionLimit,
        sectionOffset
      );
      if (!result) return null;

      if (groupOffset === 0 && sectionOffset === 0) {
        // First page: replace
        groupsRef.current = result.groups;
        sectionsRef.current = result.sections;
      } else {
        // Subsequent pages: append, dedup by ID
        if (groupOffset > 0) {
          const existingGroupIds = new Set(groupsRef.current.map((g) => g.groupId));
          for (const g of result.groups) {
            if (!existingGroupIds.has(g.groupId)) {
              groupsRef.current.push(g);
            }
          }
        }
        if (sectionOffset > 0) {
          const existingSectionIds = new Set(sectionsRef.current.map((s) => s.id));
          for (const s of result.sections) {
            if (!existingSectionIds.has(s.id)) {
              sectionsRef.current.push(s);
            }
          }
        }
        // When only one offset advanced, keep the other from the ref
        if (groupOffset === 0) {
          groupsRef.current = result.groups;
        }
        if (sectionOffset === 0) {
          sectionsRef.current = result.sections;
        }
      }

      hasMoreGroupsRef.current = result.hasMoreGroups;
      hasMoreSectionsRef.current = result.hasMoreSections;

      return {
        activityCount: result.activityCount,
        groupCount: result.groupCount,
        sectionCount: result.sectionCount,
        oldestDate: result.oldestDate,
        newestDate: result.newestDate,
        groups: [...groupsRef.current],
        sections: [...sectionsRef.current],
        hasMoreGroups: result.hasMoreGroups,
        hasMoreSections: result.hasMoreSections,
      } as PaginatedRoutesData;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, groupOffset, sectionOffset, groupLimit, sectionLimit]);

  const loadMoreGroups = useCallback(() => {
    if (hasMoreGroupsRef.current) {
      setGroupOffset((prev) => prev + groupLimit);
    }
  }, [groupLimit]);

  const loadMoreSections = useCallback(() => {
    if (hasMoreSectionsRef.current) {
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
