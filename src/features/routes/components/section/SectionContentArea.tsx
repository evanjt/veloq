import React from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
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
  FfiSectionTrendCurves,
  MergeCandidate,
} from 'veloqrs';
import type { DirectionStats, PerformanceDataPoint, RoutePoint } from '@/types';
import type { SectionDeltaLine } from '@/features/routes/lib/deltaLayout';

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
  /** The engine's lap delta curves for the range and sport on screen. */
  curves?: FfiSectionLapCurves | undefined;
  /** Called with the attempt the delta plot emphasises while it is shown, else null. */
  onDeltaLineChange?: ((line: SectionDeltaLine | null) => void) | undefined;
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
  forwardColour: string;
  navActivityId?: string | undefined;
  effectiveReferenceId?: string | undefined;
  showExcluded: boolean;
  /** The range and sport hold excluded attempts the eye toggle can show. */
  hasExcluded: boolean;
  sectionTimeRange: SectionTimeRange;
  onActivitySelect: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
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
  curves,
  onDeltaLineChange,
  forwardStats,
  reverseStats,
  bestForwardRecord,
  bestReverseRecord,
  bestForwardIsRecord,
  bestReverseIsRecord,
  recordsSettled,
  calendarSummary,
  effectiveSportType,
  forwardColour,
  navActivityId,
  effectiveReferenceId,
  showExcluded,
  hasExcluded,
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
      {/* Disabled banner */}
      {isSectionDisabled && onToggleDisable ? (
        <Pressable
          testID="section-disabled-banner"
          style={pressable([styles.disabledBanner, isDark && styles.disabledBannerDark])}
          accessibilityRole="button"
          accessibilityLabel={t('sections.restoreSection')}
          onPress={onToggleDisable}
          android_ripple={pressRipple}
        >
          <MaterialCommunityIcons
            name="delete-outline"
            size={iconSize.md}
            color={isDark ? darkColors.warningAmber : colors.warningAmber}
          />
          <Text
            style={[
              styles.disabledBannerText,
              { color: isDark ? darkColors.warningAmber : colors.warningAmber },
            ]}
          >
            {t('sections.removed')} - {t('sections.restoreSection')}
          </Text>
        </Pressable>
      ) : null}

      {/* Merge candidates banner */}
      {mergeCandidates && mergeCandidates.length > 0 && onMergePress ? (
        <Pressable
          testID="section-merge-banner"
          style={pressable([styles.mergeBanner, isDark && styles.mergeBannerDark])}
          accessibilityRole="button"
          accessibilityLabel={t('sections.mergeCandidatesTitle')}
          onPress={onMergePress}
          android_ripple={pressRipple}
        >
          <MaterialCommunityIcons name="call-merge" size={iconSize.md} color={colors.info} />
          <Text style={[styles.mergeBannerText, isDark && styles.mergeBannerTextDark]}>
            {t('sections.similarNearbyCount', {
              count: mergeCandidates.length,
            })}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={iconSize.md}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
      ) : null}

      {/* Performance chart with eye toggle */}
      <SectionPerformanceSection
        subject={subject}
        isDark={isDark}
        forwardColour={forwardColour}
        sportType={effectiveSportType}
        chartData={combinedChartData}
        trendCurves={trendCurves}
        histograms={histograms}
        curves={curves}
        onDeltaLineChange={onDeltaLineChange}
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
        hasExcluded={hasExcluded}
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
        activityColor={forwardColour}
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
          activityColor={forwardColour}
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
  disabledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warning + '15',
    borderWidth: 1,
    borderColor: colors.warning + '30',
    borderRadius: layout.borderRadius,
    padding: spacing.md,
  },
  disabledBannerDark: {
    backgroundColor: colors.warning + '20',
    borderColor: colors.warning + '40',
  },
  // The colour is the consumer's: amber has to be the deep tone on white and
  // the light tone on near-black, and a stylesheet cannot read the theme.
  disabledBannerText: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
  },
  mergeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.info + '10',
    borderWidth: 1,
    borderColor: colors.info + '25',
    borderRadius: layout.borderRadius,
    padding: spacing.md,
  },
  mergeBannerDark: {
    backgroundColor: colors.info + '15',
    borderColor: colors.info + '30',
  },
  mergeBannerText: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.infoText,
  },
  mergeBannerTextDark: {
    color: darkColors.infoText,
  },
});
