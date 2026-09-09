import {
  filterInsightsForNotificationPreferences,
  formatInsightNotification,
  pickBestInsightForNotification,
} from '@/features/insights/notifications';
import type { Insight } from '@/types';
import type { NotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';

function createInsight(
  id: string,
  category: Insight['category'],
  priority: Insight['priority']
): Insight {
  return {
    id,
    category,
    priority,
    title: id,
    icon: 'star',
    iconColor: '#000',
    timestamp: 0,
    isNew: true,
  };
}

describe('insight notifications', () => {
  const preferences: NotificationPreferences = {
    enabled: true,
    privacyAccepted: true,
    pendingUnregister: false,
    categories: {
      sectionPr: false,
      fitnessMilestone: true,
    },
  };

  it('filters insights using category preferences', () => {
    const insights = [
      createInsight('pr', 'section_pr', 1),
      createInsight('milestone', 'fitness_milestone', 2),
      createInsight('period', 'period_comparison', 3),
      createInsight('stale', 'stale_pr', 4),
    ];

    expect(
      filterInsightsForNotificationPreferences(insights, preferences).map((i) => i.id)
    ).toEqual(['milestone', 'period', 'stale']);
  });

  it('picks the best remaining allowed insight', () => {
    const allowedInsights = filterInsightsForNotificationPreferences(
      [
        createInsight('pr', 'section_pr', 1),
        createInsight('milestone', 'fitness_milestone', 3),
        createInsight('stale', 'stale_pr', 2),
      ],
      preferences
    );

    expect(pickBestInsightForNotification(allowedInsights)?.id).toBe('milestone');
  });

  it('routes route-analysis notifications to the dedicated route workspace', () => {
    const translate = (key: string) => key;
    const content = formatInsightNotification(createInsight('stale', 'stale_pr', 2), translate);

    expect(content.data.route).toBe('/insights?tab=sections');
  });

  it('suppresses strength insight notifications until preference coverage exists', () => {
    const insights = [
      createInsight('strength-progress', 'strength_progression', 2),
      createInsight('strength-balance', 'strength_balance', 2),
      createInsight('milestone', 'fitness_milestone', 3),
    ];

    expect(
      filterInsightsForNotificationPreferences(insights, preferences).map((i) => i.id)
    ).toEqual(['milestone']);
  });

  it('keeps the score order it is given when no PR or milestone is present', () => {
    const scoreOrdered = [
      createInsight('stale', 'stale_pr', 4),
      createInsight('period', 'period_comparison', 2),
    ];

    expect(pickBestInsightForNotification(scoreOrdered)?.id).toBe('stale');
  });

  it('still prefers a section PR that sits below a higher-scoring insight', () => {
    const scoreOrdered = [
      createInsight('period', 'period_comparison', 2),
      createInsight('pr', 'section_pr', 4),
    ];

    expect(pickBestInsightForNotification(scoreOrdered)?.id).toBe('pr');
  });

  it('returns null for an empty list', () => {
    expect(pickBestInsightForNotification([])).toBeNull();
  });
});
