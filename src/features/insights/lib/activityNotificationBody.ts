import type { NotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { formatDurationDelta } from '@/shared/format/format';

import type { Insight, TFunc } from '../types';

export interface ActivityInfo {
  name: string;
  type: string;
  ingested: boolean;
  distance?: number;
  movingTime?: number;
}

export function formatBasicStat(info: ActivityInfo | null, t: TFunc): string | null {
  if (!info) return null;
  const km = info.distance && info.distance > 0 ? info.distance / 1000 : 0;
  const mins = info.movingTime && info.movingTime > 0 ? Math.round(info.movingTime / 60) : 0;
  if (km >= 1 && mins > 0) {
    return t('notifications.activityBody.distanceAndTime', { km: km.toFixed(1), min: mins });
  }
  if (km >= 1) {
    return t('notifications.activityBody.distanceOnly', { km: km.toFixed(1) });
  }
  if (mins > 0) {
    return t('notifications.activityBody.timeOnly', { min: mins });
  }
  return null;
}

interface PerfRecord {
  activityId: string;
  bestTime: number;
  direction: string;
}

interface PerfResult {
  records?: PerfRecord[];
  bestRecord?: PerfRecord | null;
}

/**
 * Seconds this activity's section PR improved on the previous best, from the
 * records already returned by getPerformancesBatch. Null when this is the
 * only timed attempt in the PR's direction, or times tie.
 */
export function computeSectionPrDelta(
  result: PerfResult | undefined,
  activityId: string
): number | null {
  const best = result?.bestRecord;
  if (!best || best.activityId !== activityId) return null;
  if (!Number.isFinite(best.bestTime) || best.bestTime <= 0) return null;
  const others = (result.records ?? []).filter(
    (r) =>
      r.activityId !== activityId &&
      r.direction === best.direction &&
      Number.isFinite(r.bestTime) &&
      r.bestTime > 0
  );
  if (others.length === 0) return null;
  const previousBest = Math.min(...others.map((r) => r.bestTime));
  const delta = previousBest - best.bestTime;
  return delta > 0 ? delta : null;
}

/**
 * Matched-route signal for this activity, from the same engine data that
 * drives the activity-card route badge. Best-effort: returns null when the
 * activity is not (yet) in any route group.
 */
function getRouteHighlight(activityId: string): {
  routeName: string;
  isPr: boolean;
  trendUp: boolean;
  timeDeltaSeconds: number | null;
  prImprovementSeconds: number | null;
} | null {
  try {
    const { routeEngine } = require('veloqrs');
    type Highlight = {
      activityId: string;
      routeName: string;
      isPr: boolean;
      trend: number;
      timeDeltaSeconds?: number | null;
      prImprovementSeconds?: number | null;
    };
    const highlights: Highlight[] = routeEngine.getActivityRouteHighlights([activityId]);
    const h = highlights?.find((entry) => entry.activityId === activityId);
    if (!h) return null;
    return {
      routeName: h.routeName ?? '',
      isPr: !!h.isPr,
      trendUp: h.trend > 0,
      timeDeltaSeconds: typeof h.timeDeltaSeconds === 'number' ? h.timeDeltaSeconds : null,
      prImprovementSeconds:
        typeof h.prImprovementSeconds === 'number' && h.prImprovementSeconds > 0
          ? h.prImprovementSeconds
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Build an activity-centric notification body.
 * Queries the engine to find the matched route, section PRs, and matches for
 * THIS specific activity, rather than relying on generic insight fingerprint
 * diffing.
 */
export function buildActivityNotificationBody(
  activityId: string,
  activityName: string,
  newInsights: Insight[],
  prefs: NotificationPreferences,
  activityInfo: ActivityInfo | null,
  t: TFunc
): string {
  const route = getRouteHighlight(activityId);

  try {
    const { routeEngine } = require('veloqrs');

    // Check which sections this activity traversed
    // Rust already filters out disabled/superseded sections
    const sections = routeEngine.getSectionsForActivity(activityId);
    const sectionCount = sections?.length ?? 0;

    let prCount = 0;
    let prSectionName = '';
    let prSectionHasName = false;
    let prSectionDelta: number | null = null;
    if (sectionCount > 0) {
      // Single batched FFI call instead of one per section. Saves
      // (N-1) × ~10-30 ms of round-trip overhead in the background task.
      const sectionIds = sections.map((s: { id: string }) => s.id);
      type BatchEntry = { sectionId: string; result: PerfResult };
      const batch: BatchEntry[] = (() => {
        try {
          return routeEngine.getPerformancesBatch(sectionIds);
        } catch {
          return [];
        }
      })();
      const perfById = new Map(batch.map((entry: BatchEntry) => [entry.sectionId, entry.result]));

      for (const section of sections) {
        const perf = perfById.get(section.id);
        if (perf?.bestRecord?.activityId === activityId) {
          prCount++;
          if (!prSectionName) {
            prSectionHasName = !!section.name;
            prSectionName = section.name || t('notifications.activityBody.aSection');
            prSectionDelta = computeSectionPrDelta(perf, activityId);
          }
        }
      }
    }

    // Achievements first (gated by the PR category preference), then the
    // matched-route identity, then plain traversal counts. Each delta key
    // falls back to its no-delta sibling when the comparison isn't available.
    if (prefs.categories.sectionPr) {
      if (route?.isPr && route.routeName) {
        const detail = route.prImprovementSeconds
          ? t('notifications.activityBody.routePrDelta', {
              name: route.routeName,
              delta: formatDurationDelta(route.prImprovementSeconds),
            })
          : t('notifications.activityBody.routePr', { name: route.routeName });
        return `${activityName} - ${detail}`;
      }
      if (prCount === 1) {
        const detail = prSectionDelta
          ? t('notifications.activityBody.sectionPrDelta', {
              name: prSectionName,
              delta: formatDurationDelta(prSectionDelta),
            })
          : t('notifications.activityBody.sectionPr', { name: prSectionName });
        return `${activityName} - ${detail}`;
      }
      if (prCount > 1) {
        const detail = prSectionHasName
          ? t('notifications.activityBody.sectionPrMany', {
              name: prSectionName,
              count: prCount - 1,
            })
          : t('notifications.activityBody.sectionPrCount', { count: prCount });
        return `${activityName} - ${detail}`;
      }
      if (route?.isPr) {
        const detail = route.prImprovementSeconds
          ? t('notifications.activityBody.routePrUnnamedDelta', {
              delta: formatDurationDelta(route.prImprovementSeconds),
            })
          : t('notifications.activityBody.routePrUnnamed');
        return `${activityName} - ${detail}`;
      }
    }

    if (route?.trendUp && route.routeName) {
      const detail =
        route.timeDeltaSeconds != null && route.timeDeltaSeconds > 0
          ? t('notifications.activityBody.fasterOnRouteDelta', {
              name: route.routeName,
              delta: formatDurationDelta(route.timeDeltaSeconds),
            })
          : t('notifications.activityBody.fasterOnRoute', { name: route.routeName });
      return `${activityName} - ${detail}`;
    }
    if (route?.routeName) {
      return `${activityName} - ${t('notifications.activityBody.onRoute', { name: route.routeName })}`;
    }
    if (sectionCount === 1) {
      return `${activityName} - ${t('notifications.activityBody.sectionTraversedOne')}`;
    }
    if (sectionCount > 1) {
      return `${activityName} - ${t('notifications.activityBody.sectionTraversedMany', { count: sectionCount })}`;
    }
  } catch {
    // Engine query failed, fall through
  }

  // Check for new insights caused by this activity
  const milestone = newInsights.find((i) => i.category === 'fitness_milestone');
  if (milestone) {
    return `${activityName} - ${milestone.title}`;
  }

  // Fallback: basic stats so the notification isn't just the activity name
  const stat = formatBasicStat(activityInfo, t);
  if (stat) {
    return `${activityName} - ${stat}`;
  }

  return activityName;
}
