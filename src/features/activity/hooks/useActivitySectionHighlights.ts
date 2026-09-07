/**
 * Batch-fetches section indicators (from materialized table) and route highlights
 * (computed inline) for a list of activity IDs.
 *
 * Section indicators: read from the `activity_indicators` table through
 * `getActivityHighlightsBundle`.
 * Route highlights: computed inline from groups + activity_metrics via getActivityRouteHighlights().
 *
 * NOTE: The feed badge counts here are derived from the materialized
 * `activity_indicators` table populated by `compute_section_indicators()` in
 * Rust. The section detail page's calendar shows trophies at year/month
 * aggregation levels, so the user may see 3 trophy icons in the calendar
 * for what is really one all-time PR - that is a visualization artifact in
 * SectionStatsCards, not a count mismatch in this hook.
 */

import { useMemo } from 'react';
import type { ActivityHighlightsBundle } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { isRouteMatchingEnabled } from '@/features/routes/stores/RouteSettingsStore';
import { useEngineSubscription } from '@/features/routes/hooks/useEngine';
import { debug } from '@/shared/debug/debug';

const log = debug.create('ActivitySectionHighlights');

export interface ActivitySectionHighlight {
  sectionId: string;
  sectionName: string;
  direction: string;
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
  /** Seconds vs route PR moving time. Negative = ahead, positive = behind, 0 = same. Null when no comparison. */
  timeDeltaSeconds: number | null;
}

/**
 * Content-addressed identity for the highlight objects.
 *
 * `ActivityCard`'s comparator compares both highlight props by identity, and
 * the engine announces sections, groups and activities separately, five times
 * during launch alone. Each announcement rebuilds this hook's result, so
 * without this every highlighted card re-renders with nothing new to draw.
 * Keying on the rendered fields means equal content is literally the same
 * object, with no render-phase state to keep in step.
 */
const sectionIdentity = new Map<string, { key: string; value: ActivitySectionHighlight[] }>();
const routeIdentity = new Map<string, { key: string; value: ActivityRouteHighlight }>();

function sectionsKey(highlights: ActivitySectionHighlight[]): string {
  return highlights
    .map((h) => `${h.sectionId}|${h.direction}|${h.sectionName}|${h.lapTime}|${h.isPr}|${h.trend}`)
    .join(';');
}

function routeKey(highlight: ActivityRouteHighlight): string {
  const { routeId, routeName, isPr, trend, timeDeltaSeconds } = highlight;
  return `${routeId}|${routeName}|${isPr}|${trend}|${timeDeltaSeconds}`;
}

/** The stored object when the content matches, otherwise `value`, now stored. */
function carry<T>(
  cache: Map<string, { key: string; value: T }>,
  id: string,
  value: T,
  key: string
): T {
  const held = cache.get(id);
  if (held && held.key === key) return held.value;
  cache.set(id, { key, value });
  return value;
}

/** The cache follows the batch, so a feed that scrolls does not grow it. */
function prune(ids: string[]): void {
  const live = new Set(ids);
  for (const cache of [sectionIdentity, routeIdentity]) {
    for (const id of cache.keys()) {
      if (!live.has(id)) cache.delete(id);
    }
  }
}

/**
 * Returns maps of activity ID → section/route highlights for a batch of activities.
 * Re-queries when section data changes (engine subscription).
 */
export function useActivitySectionHighlights(
  activityIds: string[],
  preComputedBundle?: ActivityHighlightsBundle
): {
  sections: Map<string, ActivitySectionHighlight[]>;
  routes: Map<string, ActivityRouteHighlight>;
} {
  const trigger = useEngineSubscription(['sections', 'groups', 'activities']);
  // The list arrives as a fresh array every render, so the joined ids are what
  // the memo can be keyed on.
  const activityKey = activityIds.join(',');

  return useMemo(() => {
    const empty = {
      sections: new Map<string, ActivitySectionHighlight[]>(),
      routes: new Map<string, ActivityRouteHighlight>(),
    };

    if (!isRouteMatchingEnabled() || activityIds.length === 0) return empty;

    try {
      // Single FFI call returns both section indicators and route highlights,
      // unless the caller already has the bundle.
      let bundle = preComputedBundle;
      if (!bundle) {
        const engine = getEngine();
        if (!engine) return empty;
        bundle = engine.getActivityHighlightsBundle(activityIds);
      }
      const indicators = bundle.indicators;
      const rawRoutes = bundle.routeHighlights;
      const sectionMap = new Map<string, ActivitySectionHighlight[]>();

      for (const ind of indicators) {
        if (ind.indicatorType !== 'section_pr' && ind.indicatorType !== 'section_trend') {
          continue;
        }
        const isPr = ind.indicatorType === 'section_pr';

        const existing = sectionMap.get(ind.activityId);
        const existingEntry = existing?.find(
          (e) => e.sectionId === ind.targetId && e.direction === ind.direction
        );
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
            direction: ind.direction,
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

      // Route highlights already fetched in the bundle above.
      const routeMap = new Map<string, ActivityRouteHighlight>();
      for (const r of rawRoutes) {
        routeMap.set(r.activityId, {
          routeId: r.routeId,
          routeName: r.routeName,
          isPr: r.isPr,
          trend: r.trend,
          timeDeltaSeconds: r.timeDeltaSeconds ?? null,
        });
      }

      if (__DEV__) {
        const prRoutes = rawRoutes.filter((r) => r.isPr);
        const trendRoutes = rawRoutes.filter((r) => r.trend !== 0 && !r.isPr);
        log.log(
          `[Indicators] sections: ${sectionMap.size}, routes: ${rawRoutes.length} raw (${prRoutes.length} PR, ${trendRoutes.length} trend)`
        );
        if (prRoutes.length > 0) {
          log.log(
            `[Indicators] Route PRs:`,
            prRoutes.map((r) => `${r.activityId.slice(-6)} "${r.routeName}" trend=${r.trend}`)
          );
        }
      }

      prune(activityIds);
      for (const [id, highlights] of sectionMap) {
        sectionMap.set(id, carry(sectionIdentity, id, highlights, sectionsKey(highlights)));
      }
      for (const [id, highlight] of routeMap) {
        routeMap.set(id, carry(routeIdentity, id, highlight, routeKey(highlight)));
      }
      return { sections: sectionMap, routes: routeMap };
    } catch (e) {
      if (__DEV__) {
        console.warn('[Indicators] Failed:', e);
      }
      return empty;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityKey, trigger, preComputedBundle]);
}
