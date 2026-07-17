import type { NotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';

import type { Insight } from '../types';

export interface ActivityInfo {
  name: string;
  type: string;
  ingested: boolean;
  distance?: number;
  movingTime?: number;
}

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export function formatBasicStat(info: ActivityInfo | null, t: TranslateFn): string | null {
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

/**
 * Matched-route signal for this activity, from the same engine data that
 * drives the activity-card route badge. Best-effort: returns null when the
 * activity is not (yet) in any route group.
 */
function getRouteHighlight(
  activityId: string
): { routeName: string; isPr: boolean; trendUp: boolean } | null {
  try {
    const { routeEngine } = require('veloqrs');
    type Highlight = { activityId: string; routeName: string; isPr: boolean; trend: number };
    const highlights: Highlight[] = routeEngine.getActivityRouteHighlights([activityId]);
    const h = highlights?.find((entry) => entry.activityId === activityId);
    if (!h) return null;
    return { routeName: h.routeName ?? '', isPr: !!h.isPr, trendUp: h.trend > 0 };
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
  t: TranslateFn
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
    if (sectionCount > 0) {
      // Single batched FFI call instead of one per section. Saves
      // (N-1) × ~10-30 ms of round-trip overhead in the background task.
      const sectionIds = sections.map((s: { id: string }) => s.id);
      type BatchEntry = { sectionId: string; result: { bestRecord?: { activityId?: string } } };
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
            prSectionName = section.name || t('notifications.activityBody.aSection');
          }
        }
      }
    }

    // Achievements first (gated by the PR category preference), then the
    // matched-route identity, then plain traversal counts.
    if (prefs.categories.sectionPr) {
      if (route?.isPr && route.routeName) {
        return `${activityName} — ${t('notifications.activityBody.routePr', { name: route.routeName })}`;
      }
      if (prCount === 1) {
        return `${activityName} — ${t('notifications.activityBody.sectionPr', { name: prSectionName })}`;
      }
      if (prCount > 1) {
        return `${activityName} — ${t('notifications.activityBody.sectionPrCount', { count: prCount })}`;
      }
      if (route?.isPr) {
        return `${activityName} — ${t('notifications.activityBody.routePrUnnamed')}`;
      }
    }

    if (route?.trendUp && route.routeName) {
      return `${activityName} — ${t('notifications.activityBody.fasterOnRoute', { name: route.routeName })}`;
    }
    if (route?.routeName) {
      return `${activityName} — ${t('notifications.activityBody.onRoute', { name: route.routeName })}`;
    }
    if (sectionCount === 1) {
      return `${activityName} — ${t('notifications.activityBody.sectionTraversedOne')}`;
    }
    if (sectionCount > 1) {
      return `${activityName} — ${t('notifications.activityBody.sectionTraversedMany', { count: sectionCount })}`;
    }
  } catch {
    // Engine query failed, fall through
  }

  // Check for new insights caused by this activity
  const milestone = newInsights.find((i) => i.category === 'fitness_milestone');
  if (milestone) {
    return `${activityName} — ${milestone.title}`;
  }

  // Fallback: basic stats so the notification isn't just the activity name
  const stat = formatBasicStat(activityInfo, t);
  if (stat) {
    return `${activityName} — ${stat}`;
  }

  return activityName;
}
