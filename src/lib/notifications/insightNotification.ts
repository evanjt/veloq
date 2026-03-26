import type { Insight } from '@/types';
import type { InsightNotificationData } from './notificationService';

type TFunc = (key: string, params?: Record<string, string | number>) => string;

interface NotificationContent {
  title: string;
  body: string;
  data: InsightNotificationData;
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
        data: { route: '/routes', insightId: insight.id },
      };

    case 'tsb_form':
      return {
        title: t('notifications.tsbForm.title'),
        body: insight.title,
        data: { route: '/fitness', insightId: insight.id },
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
        data: { route: '/routes', insightId: insight.id },
      };

    case 'section_cluster':
      return {
        title: t('notifications.sectionCluster.title'),
        body: insight.title,
        data: { route: '/routes', insightId: insight.id },
      };

    case 'efficiency_trend':
      return {
        title: t('notifications.efficiencyTrend.title'),
        body: insight.title,
        data: { route: '/routes', insightId: insight.id },
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
