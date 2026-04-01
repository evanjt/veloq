import {
  filterInsightsForNotificationPreferences,
  formatInsightNotification,
  pickBestInsightForNotification,
} from '@/lib/notifications/insightNotification';
import type { Insight } from '@/types';
import type { NotificationPreferences } from '@/providers/NotificationPreferencesStore';

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
    categories: {
      sectionPr: false,
      fitnessMilestone: true,
      periodComparison: false,
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
    ).toEqual(['milestone', 'stale']);
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

    expect(content.data.route).toBe('/routes?tab=sections');
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
});
