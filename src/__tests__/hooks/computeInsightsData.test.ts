import { consolidateInsights } from '@/hooks/insights/computeInsightsData';
import type { Insight } from '@/types';

function createInsight(
  id: string,
  category: Insight['category'],
  priority: Insight['priority'],
  options?: {
    timestamp?: number;
    sectionIds?: string[];
    navigationTarget?: string;
  }
): Insight {
  return {
    id,
    category,
    priority,
    title: id,
    icon: 'star',
    iconColor: '#000',
    timestamp: options?.timestamp ?? 0,
    isNew: false,
    navigationTarget: options?.navigationTarget,
    supportingData: options?.sectionIds
      ? {
          sections: options.sectionIds.map((sectionId) => ({
            sectionId,
            sectionName: sectionId,
          })),
        }
      : undefined,
  };
}

describe('consolidateInsights', () => {
  it('drops overlapping section stories when a recent PR already covers that section', () => {
    const result = consolidateInsights([
      createInsight('section-pr', 'section_pr', 1, {
        navigationTarget: '/section/s1',
      }),
      createInsight('efficiency-s1', 'efficiency_trend', 1, {
        sectionIds: ['s1'],
      }),
      createInsight('stale-s2', 'stale_pr', 2, {
        sectionIds: ['s2'],
      }),
    ]);

    expect(result.map((insight) => insight.id)).toEqual(['section-pr', 'stale-s2']);
  });

  it('keeps only the two strongest non-PR section stories', () => {
    const result = consolidateInsights([
      createInsight('stale', 'stale_pr', 2, {
        sectionIds: ['s2'],
      }),
      createInsight('efficiency', 'efficiency_trend', 1, {
        sectionIds: ['s1'],
      }),
      createInsight('efficiency2', 'efficiency_trend', 1, {
        sectionIds: ['s3'],
      }),
      createInsight('fitness', 'fitness_milestone', 2),
    ]);

    expect(result.map((insight) => insight.id)).toEqual(['efficiency', 'efficiency2', 'fitness']);
  });
});
