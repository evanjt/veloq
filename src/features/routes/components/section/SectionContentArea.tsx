import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors } from '@/theme';
import { SectionPerformanceSection, type SectionStreamsState } from './SectionPerformanceSection';
import { SectionStatsCards } from './SectionStatsCards';
import { SectionInfoCard } from './SectionInfoCard';
import { SectionEfficiencyCard } from './SectionEfficiencyCard';
import { SectionCorrelationCard } from './SectionCorrelationCard';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';
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
import type { DirectionStats, FrequentSection, PerformanceDataPoint, RoutePoint } from '@/types';
import type { SectionDeltaLine } from '@/features/routes/lib/deltaLayout';
import { styles } from './SectionDetail.styles';

export interface SectionContentAreaProps {
  isDark: boolean;
  /** The screen bundle's efficiency trend, passed to the card. */
  efficiencyTrend?: EfficiencyTrend | null | undefined;
  /** The engine's wellness correlations for the range and sport on screen. */
  correlations: FfiSectionCorrelation[];
  /** The pairs the engine required before a correlation carries a figure. */
  correlationFloor: number;
  section: FrequentSection;
  isSectionDisabled: boolean;
  mergeCandidates: MergeCandidate[];
  combinedChartData: (PerformanceDataPoint & { x: number })[];
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
  calendarSummary: CalendarSummary | null;
  /** The sport whose efforts are on screen, the one the engine answered for.
   *  Units follow it: a section has no sport of its own. */
  effectiveSportType?: string | undefined;
  isRunning: boolean;
  activityColor: string;
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
  onToggleDisable: () => void;
  onMergePress: () => void;
  /** The state of the time streams the lap times wait on. */
  streams?: SectionStreamsState | undefined;
  /** Rows that open the supporting detail pages. */
  children?: React.ReactNode;
}

export function SectionContentArea({
  isDark,
  efficiencyTrend,
  correlations,
  correlationFloor,
  section,
  isSectionDisabled,
  mergeCandidates,
  combinedChartData,
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
  calendarSummary,
  effectiveSportType,
  isRunning,
  activityColor,
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

  return (
    <View style={styles.contentSection}>
      {/* Disabled banner */}
      {isSectionDisabled && (
        <TouchableOpacity
          style={[styles.disabledBanner, isDark && styles.disabledBannerDark]}
          onPress={onToggleDisable}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name="delete-outline"
            size={18}
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
        </TouchableOpacity>
      )}

      {/* Merge candidates banner */}
      {mergeCandidates.length > 0 && (
        <TouchableOpacity
          style={[styles.mergeBanner, isDark && styles.mergeBannerDark]}
          onPress={onMergePress}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="call-merge" size={18} color={colors.info} />
          <Text style={[styles.mergeBannerText, isDark && styles.mergeBannerTextDark]}>
            {t('sections.similarNearbyCount', {
              count: mergeCandidates.length,
            })}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </TouchableOpacity>
      )}

      {/* Performance chart with eye toggle */}
      <SectionPerformanceSection
        isDark={isDark}
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
        chartData={combinedChartData}
        bestForwardRecord={bestForwardRecord}
        bestReverseRecord={bestReverseRecord}
        forwardStats={forwardStats}
        reverseStats={reverseStats}
        sportType={effectiveSportType}
        isDark={isDark}
        activityColor={activityColor}
        pending={streams?.status === 'loading'}
      />

      {/* Aerobic efficiency across matched efforts, when the engine has it */}
      <SectionEfficiencyCard
        sectionId={section.id}
        sportType={effectiveSportType}
        isDark={isDark}
        bundledTrend={efficiencyTrend}
      />

      <SectionCorrelationCard
        correlations={correlations}
        floor={correlationFloor}
        isDark={isDark}
      />

      {/* Calendar performance history */}
      {calendarSummary && (
        <SectionStatsCards
          calendarSummary={calendarSummary}
          isDark={isDark}
          isRunning={isRunning}
          activityColor={activityColor}
          onSetAsReference={onSetAsReference}
          referenceActivityId={effectiveReferenceId}
        />
      )}

      {children}
    </View>
  );
}
