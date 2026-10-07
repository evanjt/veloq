import React from 'react';
import type { Insight, InsightCategory } from '@/features/insights/types';
import { SectionPRContent } from './SectionPRContent';
import { SectionTrendContent } from './SectionTrendContent';
import { RouteInsightContent } from './RouteInsightContent';
import { StalePRContent } from './StalePRContent';
import { HrvTrendContent } from './HrvTrendContent';
import { PeriodComparisonContent } from './PeriodComparisonContent';
import { FitnessMilestoneContent } from './FitnessMilestoneContent';
import { EfficiencyTrendContent } from './EfficiencyTrendContent';
import { SupportingDataSection } from '../SupportingDataSection';

interface InsightContentProps {
  insight: Insight;
}

/** The flat list, for a category with no screen of its own. */
function SupportingDataOnly({ insight }: InsightContentProps) {
  if (!insight.supportingData) return null;
  return <SupportingDataSection data={insight.supportingData} />;
}

/**
 * The component each category opens.
 *
 * Keyed on category alone. The dispatch used to key `section_pr` and then split
 * inside that case on an id prefix, so `section_trend`, which is what the trend
 * generator emits, had no case at all and every trend card fell through to the
 * flat list. `Record` over the union is what stops that returning: a category
 * added without a screen does not compile.
 */
export const CONTENT_BY_CATEGORY: Record<
  InsightCategory,
  React.ComponentType<InsightContentProps>
> = {
  section_pr: SectionPRContent,
  section_trend: SectionTrendContent,
  stale_pr: StalePRContent,
  route: RouteInsightContent,
  fitness_milestone: FitnessMilestoneContent,
  period_comparison: PeriodComparisonContent,
  hrv_trend: HrvTrendContent,
  efficiency_trend: EfficiencyTrendContent,
  strength_progression: SupportingDataOnly,
  strength_balance: SupportingDataOnly,
  // Carries no supporting data, so this renders nothing between the body and
  // the method block. That is the screen as designed, not a missing case.
  section_changed: SupportingDataOnly,
};

export const InsightDetailContent = React.memo(function InsightDetailContent({
  insight,
}: InsightContentProps) {
  const Content = CONTENT_BY_CATEGORY[insight.category] ?? SupportingDataOnly;
  return <Content insight={insight} />;
});
