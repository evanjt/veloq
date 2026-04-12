/**
 * Batch-fetches section indicators (from materialized table) and route highlights
 * (computed inline) for a list of activity IDs.
 *
 * Section indicators: read from `activity_indicators` table via getActivityIndicators().
 * Route highlights: computed inline from groups + activity_metrics via getActivityRouteHighlights().
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
      // Section indicators from materialized table
      const indicators = engine.getActivityIndicators(activityIds);
      const sectionMap = new Map<string, ActivitySectionHighlight[]>();

      for (const ind of indicators) {
        if (ind.indicatorType !== 'section_pr' && ind.indicatorType !== 'section_trend') {
          continue;
        }
        const isPr = ind.indicatorType === 'section_pr';

        const existing = sectionMap.get(ind.activityId);
        const existingEntry = existing?.find((e) => e.sectionId === ind.targetId);
        if (existingEntry) {
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
            startIndex: 0,
            endIndex: 0,
          };
          if (existing) {
            existing.push(entry);
          } else {
            sectionMap.set(ind.activityId, [entry]);
          }
        }
      }

      // Route highlights computed inline from groups + activity_metrics
      const rawRoutes = engine.getActivityRouteHighlights(activityIds);
      const routeMap = new Map<string, ActivityRouteHighlight>();
      for (const r of rawRoutes) {
        // Only show if there's something to display (PR or non-zero trend)
        if (r.isPr || r.trend !== 0) {
          routeMap.set(r.activityId, {
            routeId: r.routeId,
            routeName: r.routeName,
            isPr: r.isPr,
            trend: r.trend,
          });
        }
      }

      if (__DEV__) {
        console.log(
          `[Indicators] sections: ${sectionMap.size} activities, routes: ${routeMap.size} activities`
        );
      }

      return { sections: sectionMap, routes: routeMap };
    } catch (e) {
      if (__DEV__) {
        console.warn('[Indicators] Failed:', e);
      }
      return empty;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityIds.join(','), trigger]);
}
