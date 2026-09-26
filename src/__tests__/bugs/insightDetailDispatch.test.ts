/**
 * Scenario: the detail sheet dispatched on category `section_pr` and then split
 * inside that case on whether the id began `section_pr-`. The trend generator
 * emits category `section_trend`, which had no case, so every "getting faster"
 * card fell through to the flat supporting-data list and `SectionTrendContent`
 * was unreachable.
 *
 * Expected behaviour: the dispatch is keyed on category alone, and every
 * category the generators emit names the component built for it.
 */

import { CONTENT_BY_CATEGORY } from '@/features/insights/components/content/InsightDetailContent';
import { SectionPRContent } from '@/features/insights/components/content/SectionPRContent';
import { SectionTrendContent } from '@/features/insights/components/content/SectionTrendContent';
import { StalePRContent } from '@/features/insights/components/content/StalePRContent';
import { HrvTrendContent } from '@/features/insights/components/content/HrvTrendContent';
import { PeriodComparisonContent } from '@/features/insights/components/content/PeriodComparisonContent';
import { FitnessMilestoneContent } from '@/features/insights/components/content/FitnessMilestoneContent';
import { EfficiencyTrendContent } from '@/features/insights/components/content/EfficiencyTrendContent';
import type { InsightCategory } from '@/features/insights/types';

/** Every category the union declares, so a new one without a mapping fails here. */
const CATEGORIES: InsightCategory[] = [
  'section_pr',
  'section_trend',
  'stale_pr',
  'fitness_milestone',
  'period_comparison',
  'strength_progression',
  'strength_balance',
  'hrv_trend',
  'efficiency_trend',
  'section_changed',
];

describe('insight detail dispatch', () => {
  it('sends a section trend to the component built for it', () => {
    expect(CONTENT_BY_CATEGORY.section_trend).toBe(SectionTrendContent);
  });

  it('sends a section PR to the PR component', () => {
    expect(CONTENT_BY_CATEGORY.section_pr).toBe(SectionPRContent);
  });

  it('names a component for the other dedicated categories', () => {
    expect(CONTENT_BY_CATEGORY.stale_pr).toBe(StalePRContent);
    expect(CONTENT_BY_CATEGORY.hrv_trend).toBe(HrvTrendContent);
    expect(CONTENT_BY_CATEGORY.period_comparison).toBe(PeriodComparisonContent);
    expect(CONTENT_BY_CATEGORY.fitness_milestone).toBe(FitnessMilestoneContent);
    expect(CONTENT_BY_CATEGORY.efficiency_trend).toBe(EfficiencyTrendContent);
  });

  it('covers every category, so a new one cannot fall through unnoticed', () => {
    for (const category of CATEGORIES) {
      expect(CONTENT_BY_CATEGORY[category]).toBeDefined();
    }
    expect(Object.keys(CONTENT_BY_CATEGORY).sort()).toEqual([...CATEGORIES].sort());
  });
});
