import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { InlineNotice } from '@/shared/ui/InlineNotice';
import { layout, spacing } from '@/theme';
import {
  SectionPerformanceSection,
  type PerformanceSubject,
  type SectionStreamsState,
} from './SectionPerformanceSection';
import { SectionStatsCards } from './SectionStatsCards';
import { SectionInfoCard } from './SectionInfoCard';
import { SectionEfficiencyCard } from './SectionEfficiencyCard';
import { SectionCorrelationCard } from './SectionCorrelationCard';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';
import { attemptBasis } from '@/features/routes/lib/attemptBasis';
import type { SectionTimeRange } from '@/features/routes/constants';
import type { CalendarSummary } from './SectionStatsCards';
import type {
  EfficiencyTrend,
  FfiSectionCorrelation,
  FfiAttemptHistograms,
  FfiSectionLapCurves,
  FfiRecordProgressions,
  FfiScatterFocus,
  FfiSectionTrendCurves,
  MergeCandidate,
} from 'veloqrs';
import type { DirectionStats, PerformanceDataPoint, RoutePoint } from '@/types';
import type { SectionDeltaLine } from '@/features/routes/lib/deltaLayout';
import type { ChartDirection } from '@/features/routes/lib/scatterData';

export interface SectionContentAreaProps {
  isDark: boolean;
  /** What the attempts are of, a section unless said otherwise. */
  subject?: PerformanceSubject | undefined;
  /** The performance read's efficiency trend for the sport on screen. */
  efficiencyTrend?: EfficiencyTrend | null | undefined;
  /** The engine's wellness correlations for the range and sport on screen. */
  correlations: FfiSectionCorrelation[];
  /** The pairs the engine required before a correlation carries a figure. */
  correlationFloor: number;
  /** The section is removed; with `onToggleDisable`, a banner offers it back. */
  isSectionDisabled?: boolean | undefined;
  /** Sections close enough to merge; with `onMergePress`, a banner opens them. */
  mergeCandidates?: MergeCandidate[] | undefined;
  combinedChartData: (PerformanceDataPoint & { x: number })[];
  /** The oldest and newest included attempt in the range, as the engine dates them. */
  firstActivityDate: Date | null;
  lastActivityDate: Date | null;
  /** The engine's trend curves for the range and sport on screen. */
  trendCurves: FfiSectionTrendCurves;
  /** The engine's attempt-time bins for the range and sport on screen. */
  histograms?: FfiAttemptHistograms | undefined;
  /** The engine's scatter range per direction, with the attempts past it counted. */
  scatterFocus?: FfiScatterFocus | undefined;
  /** The engine's record progression per direction. */
  recordProgression?: FfiRecordProgressions | undefined;
  /** The engine's lap delta curves for the range and sport on screen. */
  curves?: FfiSectionLapCurves | undefined;
  /** Called with the attempt the delta plot emphasises while it is shown, else null. */
  onDeltaLineChange?: ((line: SectionDeltaLine | null) => void) | undefined;
  /** Called with the direction the chart is on while both are drawn, else null. */
  onShownDirectionChange?: ((direction: ChartDirection | null) => void) | undefined;
  forwardStats: DirectionStats | null;
  reverseStats: DirectionStats | null;
  bestForwardRecord: SectionPerformanceRecord | null;
  bestReverseRecord: SectionPerformanceRecord | null;
  bestForwardIsRecord: boolean;
  bestReverseIsRecord: boolean;
  /**
   * Every activity's time stream is read, so the bests on screen are the
   * record. Until then no record mark is drawn. Absent means settled.
   */
  recordsSettled?: boolean | undefined;
  calendarSummary: CalendarSummary | null;
  /** The sport whose efforts are on screen, the one the engine answered for.
   *  Units follow it: a section has no sport of its own. */
  effectiveSportType?: string | undefined;
  navActivityId?: string | undefined;
  effectiveReferenceId?: string | undefined;
  showExcluded: boolean;
  /** The excluded attempts the engine holds back for the range and sport, which a link can show. */
  excludedCount: number;
  sectionTimeRange: SectionTimeRange;
  onActivitySelect: (activityId: string | null, activityPoints?: RoutePoint[], date?: Date) => void;
  onExcludeActivity: (activityId: string) => void;
  onIncludeActivity: (activityId: string) => void;
  onSetAsReference: (activityId: string) => void;
  onToggleShowExcluded: () => void;
  onTimeRangeChange: (range: SectionTimeRange) => void;
  onToggleDisable?: (() => void) | undefined;
  onMergePress?: (() => void) | undefined;
  /** The state of the time streams the lap times wait on. */
  streams?: SectionStreamsState | undefined;
  /** Rows that open the supporting detail pages. */
  children?: React.ReactNode;
}

export function SectionContentArea({
  isDark,
  subject = 'section',
  efficiencyTrend,
  correlations,
  correlationFloor,
  isSectionDisabled = false,
  mergeCandidates,
  combinedChartData,
  firstActivityDate,
  lastActivityDate,
  trendCurves,
  histograms,
  scatterFocus,
  recordProgression,
  curves,
  onDeltaLineChange,
  onShownDirectionChange,
  forwardStats,
  reverseStats,
  bestForwardRecord,
  bestReverseRecord,
  bestForwardIsRecord,
  bestReverseIsRecord,
  recordsSettled,
  calendarSummary,
  effectiveSportType,
  navActivityId,
  effectiveReferenceId,
  showExcluded,
  excludedCount,
  sectionTimeRange,
  onActivitySelect,
  onExcludeActivity,
  onIncludeActivity,
  onSetAsReference,
  onToggleShowExcluded,
  onTimeRangeChange,
  onToggleDisable,
  onMergePress,
  streams,
  children,
}: SectionContentAreaProps) {
  const { t } = useTranslation();
  // A route's chart plots moving time, so every figure beside it is a time.
  const basis = attemptBasis(effectiveSportType, subject === 'route');

  return (
    <View style={styles.contentSection}>
      {isSectionDisabled && onToggleDisable ? (
        <InlineNotice
          testID="section-disabled-banner"
          tone="warning"
          icon="delete"
          title={t('sections.sectionRemoved')}
          action={
            <Button
              testID="section-disabled-banner-restore"
              label={t('sections.restoreSection')}
              onPress={onToggleDisable}
              variant="ghost"
              size="sm"
            />
          }
        />
      ) : null}

      {mergeCandidates && mergeCandidates.length > 0 && onMergePress ? (
        <InlineNotice
          testID="section-merge-banner"
          tone="info"
          icon="call-merge"
          title={t('sections.similarNearbyCount', { count: mergeCandidates.length })}
          onPress={onMergePress}
          announce={false}
        />
      ) : null}

      {/* Performance panel */}
      <SectionPerformanceSection
        subject={subject}
        isDark={isDark}
        sportType={effectiveSportType}
        chartData={combinedChartData}
        trendCurves={trendCurves}
        histograms={histograms}
        scatterFocus={scatterFocus}
        recordProgression={recordProgression}
        curves={curves}
        onDeltaLineChange={onDeltaLineChange}
        onShownDirectionChange={onShownDirectionChange}
        forwardStats={forwardStats}
        reverseStats={reverseStats}
        bestForwardRecord={bestForwardRecord}
        bestReverseRecord={bestReverseRecord}
        bestForwardIsRecord={bestForwardIsRecord}
        bestReverseIsRecord={bestReverseIsRecord}
        recordsSettled={recordsSettled}
        onActivitySelect={onActivitySelect}
        onExcludeActivity={onExcludeActivity}
        onIncludeActivity={onIncludeActivity}
        onSetAsReference={onSetAsReference}
        referenceActivityId={effectiveReferenceId}
        showExcluded={showExcluded}
        excludedCount={excludedCount}
        onToggleShowExcluded={onToggleShowExcluded}
        highlightedActivityId={navActivityId}
        sectionTimeRange={sectionTimeRange}
        onTimeRangeChange={onTimeRangeChange}
        streams={streams}
      />

      {/* Summary card */}
      <SectionInfoCard
        firstActivityDate={firstActivityDate}
        lastActivityDate={lastActivityDate}
        bestForwardRecord={bestForwardRecord}
        bestReverseRecord={bestReverseRecord}
        forwardStats={forwardStats}
        reverseStats={reverseStats}
        basis={basis}
        isDark={isDark}
        pending={streams?.status === 'loading'}
      />

      {/* Aerobic efficiency across matched efforts, when the engine has it */}
      <SectionEfficiencyCard trend={efficiencyTrend} isDark={isDark} />

      <SectionCorrelationCard
        correlations={correlations}
        floor={correlationFloor}
        isDark={isDark}
      />

      {/* Calendar performance history */}
      {calendarSummary ? (
        <SectionStatsCards
          calendarSummary={calendarSummary}
          isDark={isDark}
          basis={basis}
          onSetAsReference={onSetAsReference}
          referenceActivityId={effectiveReferenceId}
          recordsSettled={recordsSettled}
        />
      ) : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  contentSection: {
    padding: layout.screenPadding,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
});
