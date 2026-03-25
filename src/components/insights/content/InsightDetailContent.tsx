import React from 'react';
import type { Insight } from '@/types';
import { SectionPRContent } from './SectionPRContent';
import { SectionTrendContent } from './SectionTrendContent';
import { StalePRContent } from './StalePRContent';
import { SectionClusterContent } from './SectionClusterContent';
import { TsbFormContent } from './TsbFormContent';
import { HrvTrendContent } from './HrvTrendContent';
import { PeriodComparisonContent } from './PeriodComparisonContent';
import { WeeklyLoadContent } from './WeeklyLoadContent';
import { FitnessMilestoneContent } from './FitnessMilestoneContent';
import { ConsistencyContent } from './ConsistencyContent';
import { EfficiencyTrendContent } from './EfficiencyTrendContent';
import { SupportingDataSection } from '../SupportingDataSection';

interface InsightDetailContentProps {
  insight: Insight;
  onClose: () => void;
}

export const InsightDetailContent = React.memo(function InsightDetailContent({
  insight,
  onClose,
}: InsightDetailContentProps) {
  switch (insight.category) {
    case 'section_pr': {
      // Actual PRs start with 'section_pr-', trends/summaries start with 'section_trend-' or 'rest_day-'
      const isActualPR = insight.id.startsWith('section_pr-');
      if (isActualPR) {
        return <SectionPRContent insight={insight} onClose={onClose} />;
      }
      return <SectionTrendContent insight={insight} onClose={onClose} />;
    }
    case 'tsb_form':
      return <TsbFormContent insight={insight} onClose={onClose} />;
    case 'hrv_trend':
      return <HrvTrendContent insight={insight} />;
    case 'period_comparison':
      return <PeriodComparisonContent insight={insight} />;
    case 'weekly_load':
      return <WeeklyLoadContent insight={insight} />;
    case 'fitness_milestone':
      return <FitnessMilestoneContent insight={insight} />;
    case 'training_consistency':
      return <ConsistencyContent insight={insight} />;
    case 'stale_pr':
      return <StalePRContent insight={insight} onClose={onClose} />;
    case 'section_cluster':
      return <SectionClusterContent insight={insight} onClose={onClose} />;
    case 'efficiency_trend':
      return <EfficiencyTrendContent insight={insight} onClose={onClose} />;
    default:
      // Fallback: render existing SupportingDataSection for unhandled categories
      if (insight.supportingData) {
        return <SupportingDataSection data={insight.supportingData} />;
      }
      return null;
  }
});
