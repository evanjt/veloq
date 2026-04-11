/**
 * Batch-fetches section and route highlights for a list of activity IDs.
 * Used by the feed to show trend indicators and PR badges on activity cards.
 *
 * Performance: batch SQL queries (~5-10ms for 30 activities) via Rust FFI.
 * Gates on isRouteMatchingEnabled() — returns empty maps when disabled.
 */

import { useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { isRouteMatchingEnabled } from '@/providers/RouteSettingsStore';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';

export interface ActivitySectionHighlight {
  sectionId: string;
  sectionName: string;
  lapTime: number;
  isPr: boolean;
  trend: number; // -1=slower, 0=neutral, 1=faster vs preceding avg
  startIndex: number;
  endIndex: number;
}

export interface ActivityRouteHighlight {
  routeId: string;
  routeName: string;
  isPr: boolean;
  trend: number; // -1=slower, 0=neutral, 1=faster vs preceding avg
}

/**
 * Returns maps of activity ID → section/route highlights for a batch of activities.
 * Re-queries when section data changes (engine subscription).
 */
export function useActivitySectionHighlights(activityIds: string[]): {
  sections: Map<string, ActivitySectionHighlight[]>;
  routes: Map<string, ActivityRouteHighlight>;
} {
  const trigger = useEngineSubscription(['sections', 'groups']);

  return useMemo(() => {
    const empty = {
      sections: new Map<string, ActivitySectionHighlight[]>(),
      routes: new Map<string, ActivityRouteHighlight>(),
    };

    if (!isRouteMatchingEnabled() || activityIds.length === 0) return empty;

    const engine = getRouteEngine();
    if (!engine) return empty;

    try {
      // Section highlights
      const rawSections = engine.getActivitySectionHighlights(activityIds);
      const sectionMap = new Map<string, ActivitySectionHighlight[]>();
      for (const h of rawSections) {
        const entry: ActivitySectionHighlight = {
          sectionId: h.sectionId,
          sectionName: h.sectionName,
          lapTime: h.lapTime,
          isPr: h.isPr,
          trend: h.trend ?? 0,
          startIndex: h.startIndex,
          endIndex: h.endIndex,
        };
        const existing = sectionMap.get(h.activityId);
        if (existing) {
          existing.push(entry);
        } else {
          sectionMap.set(h.activityId, [entry]);
        }
      }

      // Route highlights
      const routeMap = new Map<string, ActivityRouteHighlight>();
      try {
        const rawRoutes = engine.getActivityRouteHighlights(activityIds);
        if (__DEV__ && rawRoutes.length > 0) {
          console.log(
            `[SectionHighlights] Route highlights: ${rawRoutes.length} results`,
            rawRoutes.slice(0, 3).map((r) => `${r.routeName} trend=${r.trend} pr=${r.isPr}`)
          );
        }
        for (const r of rawRoutes) {
          routeMap.set(r.activityId, {
            routeId: r.routeId,
            routeName: r.routeName,
            isPr: r.isPr,
            trend: r.trend ?? 0,
          });
        }
      } catch (e) {
        if (__DEV__) {
          console.warn('[SectionHighlights] Route highlights failed:', e);
        }
      }

      return { sections: sectionMap, routes: routeMap };
    } catch {
      return empty;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityIds.join(','), trigger]);
}
