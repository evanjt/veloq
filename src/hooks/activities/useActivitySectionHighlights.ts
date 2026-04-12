/**
 * Batch-fetches pre-computed indicators for a list of activity IDs.
 * Used by the feed to show trend indicators and PR badges on activity cards.
 *
 * Reads from the materialized `activity_indicators` table — a single fast SQL read.
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
  const trigger = useEngineSubscription(['sections', 'groups', 'activities']);

  return useMemo(() => {
    const empty = {
      sections: new Map<string, ActivitySectionHighlight[]>(),
      routes: new Map<string, ActivityRouteHighlight>(),
    };

    if (!isRouteMatchingEnabled() || activityIds.length === 0) return empty;

    const engine = getRouteEngine();
    if (!engine) return empty;

    try {
      // Single FFI call reads from materialized activity_indicators table
      const indicators = engine.getActivityIndicators(activityIds);

      const sectionMap = new Map<string, ActivitySectionHighlight[]>();
      const routeMap = new Map<string, ActivityRouteHighlight>();

      // Also get start/end indices via the old section highlights path
      // (indicators don't store GPS indices since those are section_activities data)
      const rawSections = engine.getActivitySectionHighlights(activityIds);
      const idxMap = new Map<string, { startIndex: number; endIndex: number }>();
      for (const h of rawSections) {
        idxMap.set(`${h.activityId}:${h.sectionId}`, {
          startIndex: h.startIndex,
          endIndex: h.endIndex,
        });
      }

      for (const ind of indicators) {
        if (ind.indicatorType === 'section_pr' || ind.indicatorType === 'section_trend') {
          const key = `${ind.activityId}:${ind.targetId}`;
          const indices = idxMap.get(key) ?? { startIndex: 0, endIndex: 0 };
          const isPr = ind.indicatorType === 'section_pr';

          const existing = sectionMap.get(ind.activityId);
          // Check if we already have an entry for this section
          const existingEntry = existing?.find((e) => e.sectionId === ind.targetId);
          if (existingEntry) {
            // PR always wins
            if (isPr && !existingEntry.isPr) {
              existingEntry.isPr = true;
              existingEntry.trend = 1;
              existingEntry.lapTime = ind.lapTime;
            } else if (!existingEntry.isPr && ind.trend > existingEntry.trend) {
              existingEntry.trend = ind.trend;
            }
          } else {
            const entry: ActivitySectionHighlight = {
              sectionId: ind.targetId,
              sectionName: ind.targetName,
              lapTime: ind.lapTime,
              isPr,
              trend: isPr ? 1 : ind.trend,
              startIndex: indices.startIndex,
              endIndex: indices.endIndex,
            };
            if (existing) {
              existing.push(entry);
            } else {
              sectionMap.set(ind.activityId, [entry]);
            }
          }
        } else if (ind.indicatorType === 'route_pr' || ind.indicatorType === 'route_trend') {
          const isPr = ind.indicatorType === 'route_pr';
          const existing = routeMap.get(ind.activityId);
          if (existing) {
            if (isPr && !existing.isPr) {
              existing.isPr = true;
              existing.trend = 1;
            } else if (!existing.isPr && ind.trend > existing.trend) {
              existing.trend = ind.trend;
            }
          } else {
            routeMap.set(ind.activityId, {
              routeId: ind.targetId,
              routeName: ind.targetName,
              isPr,
              trend: isPr ? 1 : ind.trend,
            });
          }
        }
      }

      return { sections: sectionMap, routes: routeMap };
    } catch {
      return empty;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityIds.join(','), trigger]);
}
