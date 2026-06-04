import React from 'react';
import type { Insight } from '@/types';
import { SectionPRContent } from './SectionPRContent';
import { SectionTrendContent } from './SectionTrendContent';
import { StalePRContent } from './StalePRContent';
import { HrvTrendContent } from './HrvTrendContent';
import { PeriodComparisonContent } from './PeriodComparisonContent';
import { FitnessMilestoneContent } from './FitnessMilestoneContent';
import { EfficiencyTrendContent } from './EfficiencyTrendContent';
import { SupportingDataSection } from '../SupportingDataSection';

interface InsightDetailContentProps {
  insight: Insight;
}

export const InsightDetailContent = React.memo(function InsightDetailContent({
  insight,
}: InsightDetailContentProps) {
  switch (insight.category) {
    case 'section_pr': {
      // Actual PRs start with 'section_pr-', trends/summaries start with 'section_trend-' or 'rest_day-'
      const isActualPR = insight.id.startsWith('section_pr-');
      if (isActualPR) {
        return <SectionPRContent insight={insight} />;
      }
      return <SectionTrendContent insight={insight} />;
    }
    case 'hrv_trend':
      return <HrvTrendContent insight={insight} />;
    case 'period_comparison':
      return <PeriodComparisonContent insight={insight} />;
    case 'fitness_milestone':
      return <FitnessMilestoneContent insight={insight} />;
    case 'stale_pr':
      return <StalePRContent insight={insight} />;
    case 'efficiency_trend':
      return <EfficiencyTrendContent insight={insight} />;
    case 'strength_progression':
    case 'strength_balance':
      if (insight.supportingData) {
        return <SupportingDataSection data={insight.supportingData} />;
      }
      return null;
    default:
      // Fallback: render existing SupportingDataSection for unhandled categories
      if (insight.supportingData) {
        return <SupportingDataSection data={insight.supportingData} />;
      }
      return null;
  }
});
