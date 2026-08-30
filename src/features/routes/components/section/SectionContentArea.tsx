import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors } from '@/theme';
import { SectionPerformanceSection } from './SectionPerformanceSection';
import { SectionStatsCards } from './SectionStatsCards';
import { SectionInfoCard } from './SectionInfoCard';
import { SectionEfficiencyCard } from './SectionEfficiencyCard';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';
import type { SectionTimeRange } from '@/features/routes/constants';
import type { CalendarSummary } from './SectionStatsCards';
import type { MergeCandidate } from 'veloqrs';
import type { DirectionStats, FrequentSection, PerformanceDataPoint, RoutePoint } from '@/types';
import { styles } from './SectionDetail.styles';

export interface SectionContentAreaProps {
  isDark: boolean;
  section: FrequentSection;
  isSectionDisabled: boolean;
  mergeCandidates: MergeCandidate[];
  combinedChartData: (PerformanceDataPoint & { x: number })[];
  forwardStats: DirectionStats | null;
  reverseStats: DirectionStats | null;
  bestForwardRecord: SectionPerformanceRecord | null;
  bestReverseRecord: SectionPerformanceRecord | null;
  calendarSummary: CalendarSummary | null;
  /** The sport whose efforts are on screen. Units follow it, not the
   *  section's own label, which is only the dominant sport of the ground. */
  effectiveSportType?: string;
  isRunning: boolean;
  activityColor: string;
  navActivityId?: string;
  effectiveReferenceId?: string;
  showExcluded: boolean;
  excludedActivityIds: Set<string>;
  sectionTimeRange: SectionTimeRange;
  onActivitySelect: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  onExcludeActivity: (activityId: string) => void;
  onIncludeActivity: (activityId: string) => void;
  onSetAsReference: (activityId: string) => void;
  onToggleShowExcluded: () => void;
  onTimeRangeChange: (range: SectionTimeRange) => void;
  onToggleDisable: () => void;
  onMergePress: () => void;
}

export function SectionContentArea({
  isDark,
  section,
  isSectionDisabled,
  mergeCandidates,
  combinedChartData,
  forwardStats,
  reverseStats,
  bestForwardRecord,
  bestReverseRecord,
  calendarSummary,
  effectiveSportType,
  isRunning,
  activityColor,
  navActivityId,
  effectiveReferenceId,
  showExcluded,
  excludedActivityIds,
  sectionTimeRange,
  onActivitySelect,
  onExcludeActivity,
  onIncludeActivity,
  onSetAsReference,
  onToggleShowExcluded,
  onTimeRangeChange,
  onToggleDisable,
  onMergePress,
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
          <MaterialCommunityIcons name="delete-outline" size={18} color={colors.warning} />
          <Text style={styles.disabledBannerText}>
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
        sportType={effectiveSportType ?? section.sportType}
        chartData={combinedChartData}
        forwardStats={forwardStats}
        reverseStats={reverseStats}
        bestForwardRecord={bestForwardRecord}
        bestReverseRecord={bestReverseRecord}
        onActivitySelect={onActivitySelect}
        onExcludeActivity={onExcludeActivity}
        onIncludeActivity={onIncludeActivity}
        onSetAsReference={onSetAsReference}
        referenceActivityId={effectiveReferenceId}
        showExcluded={showExcluded}
        hasExcluded={excludedActivityIds.size > 0}
        onToggleShowExcluded={onToggleShowExcluded}
        highlightedActivityId={navActivityId}
        sectionTimeRange={sectionTimeRange}
        onTimeRangeChange={onTimeRangeChange}
      />

      {/* Summary card */}
      <SectionInfoCard
        chartData={combinedChartData}
        bestForwardRecord={bestForwardRecord}
        bestReverseRecord={bestReverseRecord}
        forwardStats={forwardStats}
        reverseStats={reverseStats}
        sportType={effectiveSportType ?? section.sportType}
        isDark={isDark}
      />

      {/* Aerobic efficiency across matched efforts, when the engine has it */}
      <SectionEfficiencyCard sectionId={section.id} isDark={isDark} />

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
    </View>
  );
}
