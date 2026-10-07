/**
 * Performance chart section for the section detail page.
 * Uses a fixed-width scatter chart with a Gaussian kernel trend and a local
 * standard deviation band per direction.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PerformanceChartPanel } from './PerformanceChartPanel';
import type {
  DirectionBestRecord,
  DirectionSummaryStats,
} from '@/features/routes/lib/performanceTypes';
import { SECTION_TIME_RANGES, type SectionTimeRange } from '@/features/routes/constants';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { FfiAttemptHistograms, FfiSectionLapCurves, FfiSectionTrendCurves } from 'veloqrs';
import type { SectionDeltaLine } from '@/features/routes/lib/deltaLayout';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';
import { ChipSelector, Shimmer, EngineReadFailureRetry } from '@/shared/ui';
import { FLOW_EXPAND, completeFlowAfterFrame, markFlow } from '@/shared/debug/flowTiming';

/** Where the time streams the section's lap times depend on stand. */
export type SectionStreamsState =
  | { status: 'ready'; onRetry: () => void }
  | { status: 'loading'; onRetry: () => void }
  | { status: 'failed'; error: unknown; onRetry: () => void };

export const PERFORMANCE_PLACEHOLDER_HEIGHT = 120;

export interface SectionPerformanceSectionProps {
  isDark: boolean;
  /** The sport whose efforts are plotted. Decides pace against speed units. */
  /** The sport on screen, absent until the engine has answered. */
  sportType: string | undefined;
  chartData: (PerformanceDataPoint & { x: number })[];
  /** The engine's trend curves for the range and sport on screen. */
  trendCurves: FfiSectionTrendCurves;
  /** The engine's attempt-time bins for the range and sport on screen. */
  histograms?: FfiAttemptHistograms | undefined;
  /** The engine's lap delta curves for the range and sport on screen. */
  curves?: FfiSectionLapCurves | undefined;
  /** Called with the attempt the delta plot emphasises while it is shown, else null. */
  onDeltaLineChange?: ((line: SectionDeltaLine | null) => void) | undefined;
  forwardStats: DirectionSummaryStats | null;
  reverseStats: DirectionSummaryStats | null;
  bestForwardRecord: DirectionBestRecord | null;
  bestReverseRecord: DirectionBestRecord | null;
  bestForwardIsRecord: boolean;
  bestReverseIsRecord: boolean;
  onActivitySelect: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  onExcludeActivity?: ((activityId: string) => void) | undefined;
  onIncludeActivity?: ((activityId: string) => void) | undefined;
  onSetAsReference?: ((activityId: string) => void) | undefined;
  referenceActivityId?: string | undefined;
  showExcluded?: boolean | undefined;
  hasExcluded?: boolean | undefined;
  onToggleShowExcluded?: (() => void) | undefined;
  highlightedActivityId?: string | undefined;
  sectionTimeRange: SectionTimeRange;
  onTimeRangeChange: (range: SectionTimeRange) => void;
  /** Absent means settled. While streams load or failed, an empty chart is not a result. */
  streams?: SectionStreamsState | undefined;
}

export function SectionPerformanceSection({
  isDark,
  sportType,
  chartData,
  trendCurves,
  histograms,
  curves,
  onDeltaLineChange,
  forwardStats,
  reverseStats,
  bestForwardRecord,
  bestReverseRecord,
  bestForwardIsRecord,
  bestReverseIsRecord,
  onActivitySelect,
  onExcludeActivity,
  onIncludeActivity,
  onSetAsReference,
  referenceActivityId,
  showExcluded,
  hasExcluded,
  onToggleShowExcluded,
  highlightedActivityId,
  sectionTimeRange,
  onTimeRangeChange,
  streams,
}: SectionPerformanceSectionProps) {
  const { t } = useTranslation();
  const hasEfforts = chartData.length > 0;

  useEffect(() => {
    completeFlowAfterFrame(FLOW_EXPAND);
  }, [sectionTimeRange, chartData]);

  return (
    <View style={styles.chartSection}>
      <View style={styles.chartHeader}>
        <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]} numberOfLines={1}>
          {t('sections.performanceOverTime')}
        </Text>
        <ChipSelector
          style={styles.timeRangePills}
          options={SECTION_TIME_RANGES.map((r) => ({
            value: r.id,
            label: t(r.labelKey as never),
          }))}
          value={sectionTimeRange}
          optionTestID={(id) => `section-time-range-${id}`}
          onChange={(id) => {
            if (id !== sectionTimeRange) markFlow(FLOW_EXPAND);
            onTimeRangeChange(id);
          }}
        />
      </View>
      {hasEfforts ? (
        <PerformanceChartPanel
          chartData={chartData}
          trendCurves={trendCurves}
          histograms={histograms}
          curves={curves}
          onDeltaLineChange={onDeltaLineChange}
          activityType={sportType as ActivityType}
          isDark={isDark}
          bestForwardRecord={bestForwardRecord}
          bestReverseRecord={bestReverseRecord}
          bestForwardIsRecord={bestForwardIsRecord}
          bestReverseIsRecord={bestReverseIsRecord}
          forwardStats={forwardStats}
          reverseStats={reverseStats}
          onActivitySelect={onActivitySelect}
          onExcludeActivity={onExcludeActivity}
          onIncludeActivity={onIncludeActivity}
          onSetAsReference={onSetAsReference}
          referenceActivityId={referenceActivityId}
          showExcluded={showExcluded}
          hasExcluded={hasExcluded}
          onToggleShowExcluded={onToggleShowExcluded}
          highlightedActivityId={highlightedActivityId}
        />
      ) : streams?.status === 'loading' ? (
        <View testID="section-performance-pending" style={styles.emptyState}>
          <Shimmer height={PERFORMANCE_PLACEHOLDER_HEIGHT} />
        </View>
      ) : streams?.status === 'failed' ? (
        <EngineReadFailureRetry
          testID="section-performance-stream-failure"
          error={streams.error}
          onRetry={streams.onRetry}
        />
      ) : (
        <View testID="section-performance-empty" style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>
            {t('sections.noActivitiesFound')}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chartSection: {},
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  chartTitle: {
    flexShrink: 1,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chartTitleDark: {
    color: darkColors.textPrimary,
  },
  timeRangePills: {
    flexShrink: 0,
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  emptyState: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  emptyText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  emptyTextDark: {
    color: darkColors.textSecondary,
  },
});
