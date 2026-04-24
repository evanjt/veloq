import type { Insight } from '@/types';
import type { InsightNotificationData } from './notificationService';
import type { NotificationPreferences } from '@/providers/NotificationPreferencesStore';
import { INSIGHTS_CONFIG } from '@/hooks/insights/config';

type TFunc = (key: string, params?: Record<string, string | number>) => string;

interface NotificationContent {
  title: string;
  body: string;
  data: InsightNotificationData;
}

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;

/**
 * D11 — push frequency cooldown. Given a history of recent push timestamps
 * (ms epoch), returns true if a new push is allowed right now.
 *
 * Rules:
 *   - at most `maxPerWeek` pushes in any rolling 7-day window
 *   - at least `minHoursBetween` between consecutive pushes
 *
 * Caller is responsible for persisting the history (AsyncStorage). Keeping
 * the predicate pure makes it trivially testable.
 */
export function isPushAllowed(
  history: number[],
  now: number = Date.now(),
  cfg = INSIGHTS_CONFIG.push
): boolean {
  if (!cfg.enabled) return false;
  if (history.length === 0) return true;

  const sorted = [...history].sort((a, b) => b - a); // newest first
  const lastPush = sorted[0];
  if (now - lastPush < cfg.minHoursBetween * HOUR_MS) return false;

  const windowStart = now - WEEK_MS;
  const inWindow = sorted.filter((ts) => ts >= windowStart).length;
  if (inWindow >= cfg.maxPerWeek) return false;

  return true;
}

/** Prune a push-history list to values within the last 7 days. */
export function prunePushHistory(history: number[], now: number = Date.now()): number[] {
  const windowStart = now - WEEK_MS;
  return history.filter((ts) => ts >= windowStart);
}

const CATEGORY_PREFS: Partial<
  Record<Insight['category'], keyof NotificationPreferences['categories']>
> = {
  section_pr: 'sectionPr',
  fitness_milestone: 'fitnessMilestone',
};

const SUPPRESSED_NOTIFICATION_CATEGORIES = new Set<Insight['category']>([
  'strength_progression',
  'strength_balance',
]);

/**
 * Apply the user's notification category toggles to a list of insights.
 * Categories without an explicit toggle remain eligible.
 */
export function filterInsightsForNotificationPreferences(
  insights: Insight[],
  preferences: NotificationPreferences
): Insight[] {
  return insights.filter((insight) => {
    if (SUPPRESSED_NOTIFICATION_CATEGORIES.has(insight.category)) return false;
    const prefKey = CATEGORY_PREFS[insight.category];
    return prefKey ? preferences.categories[prefKey] : true;
  });
}

/**
 * Format an Insight into notification content.
 * Pure function — no React dependencies, safe for background task use.
 */
export function formatInsightNotification(insight: Insight, t: TFunc): NotificationContent {
  const route = insight.navigationTarget ?? '/routes';

  switch (insight.category) {
    case 'section_pr':
      return {
        title: t('notifications.sectionPr.title'),
        body: insight.title,
        data: {
          route: '/routes',
          insightId: insight.id,
          sectionId: insight.supportingData?.sections?.[0]?.sectionId,
        },
      };

    case 'fitness_milestone':
      return {
        title: t('notifications.fitnessMilestone.title'),
        body: insight.title,
        data: { route: '/fitness', insightId: insight.id },
      };

    case 'period_comparison':
      return {
        title: t('notifications.periodComparison.title'),
        body: insight.title,
        data: { route: '/routes?tab=routes', insightId: insight.id },
      };

    case 'hrv_trend':
      return {
        title: t('notifications.hrvTrend.title'),
        body: insight.title,
        data: { route: '/fitness', insightId: insight.id },
      };

    case 'stale_pr':
      return {
        title: t('notifications.stalePr.title'),
        body: insight.title,
        data: { route: '/routes?tab=sections', insightId: insight.id },
      };

    case 'efficiency_trend':
      return {
        title: t('notifications.efficiencyTrend.title'),
        body: insight.title,
        data: { route: '/routes?tab=sections', insightId: insight.id },
      };

    default:
      return {
        title: t('notifications.generic.title'),
        body: insight.title,
        data: { route, insightId: insight.id },
      };
  }
}

/**
 * Pick the most notification-worthy insight from a list.
 * Prioritizes: section_pr > fitness_milestone > others by priority.
 */
export function pickBestInsightForNotification(insights: Insight[]): Insight | null {
  if (insights.length === 0) return null;

  // Section PRs are always the most exciting
  const pr = insights.find((i) => i.category === 'section_pr');
  if (pr) return pr;

  // Then fitness milestones
  const milestone = insights.find((i) => i.category === 'fitness_milestone');
  if (milestone) return milestone;

  // Otherwise highest priority
  return insights.reduce((best, current) => (current.priority < best.priority ? current : best));
}
