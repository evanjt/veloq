/**
 * Batch-fetches section highlights (PRs, section counts) for a list of activity IDs.
 * Used by the feed to show section indicators on activity cards.
 *
 * Performance: single batch SQL query (~5ms for 30 activities) via Rust FFI.
 * Gates on isRouteMatchingEnabled() — returns empty map when disabled.
 */

import { useMemo, useState, useEffect } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { isRouteMatchingEnabled } from '@/providers/RouteSettingsStore';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';

export interface ActivitySectionHighlight {
  sectionId: string;
  sectionName: string;
  lapTime: number;
  isPr: boolean;
  trend: number; // -1=slower, 0=neutral, 1=faster vs preceding avg
}

/**
 * Returns a map of activity ID → section highlights for a batch of activities.
 * Re-queries when section data changes (engine subscription).
 */
export function useActivitySectionHighlights(
  activityIds: string[]
): Map<string, ActivitySectionHighlight[]> {
  // Subscribe to section changes so we re-query when detection completes
  const trigger = useEngineSubscription(['sections']);

  return useMemo(() => {
    if (!isRouteMatchingEnabled() || activityIds.length === 0) {
      return new Map<string, ActivitySectionHighlight[]>();
    }

    const engine = getRouteEngine();
    if (!engine) return new Map<string, ActivitySectionHighlight[]>();

    try {
      const raw = engine.getActivitySectionHighlights(activityIds);
      const map = new Map<string, ActivitySectionHighlight[]>();

      for (const h of raw) {
        const entry: ActivitySectionHighlight = {
          sectionId: h.sectionId,
          sectionName: h.sectionName,
          lapTime: h.lapTime,
          isPr: h.isPr,
          trend: (h as unknown as { trend?: number }).trend ?? 0,
        };
        const existing = map.get(h.activityId);
        if (existing) {
          existing.push(entry);
        } else {
          map.set(h.activityId, [entry]);
        }
      }

      return map;
    } catch {
      return new Map<string, ActivitySectionHighlight[]>();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityIds.join(','), trigger]);
}
