/**
 * Performance chart section for the section detail page.
 * Includes time range selector, bucket grouping controls, and the chart itself.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, Pressable, Modal } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import {
  UnifiedPerformanceChart,
  type ChartSummaryStats,
  type DirectionSummaryStats,
} from '@/components/routes/performance';
import {
  SECTION_TIME_RANGES,
  BUCKET_TYPES,
  DEFAULT_BUCKET_TYPE,
  type SectionTimeRange,
  type BucketType,
} from '@/constants';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';

interface DirectionBestRecord {
  bestTime: number;
  activityDate: Date;
}

export interface SectionPerformanceSectionProps {
  isDark: boolean;
  section: {
    sportType: string;
  };
  useBucketedChart: boolean;
  bucketChartData: (PerformanceDataPoint & { x: number })[];
  bucketMinSpeed: number;
  bucketMaxSpeed: number;
  bucketBestIndex: number;
  bucketHasReverseRuns: boolean;
  bucketSummaryStats: ChartSummaryStats | null;
  bucketForwardStats: DirectionSummaryStats | null;
  bucketReverseStats: DirectionSummaryStats | null;
  bucketBestForward: DirectionBestRecord | null;
  bucketBestReverse: DirectionBestRecord | null;
  bucketTotalTraversals: number;
  chartData: (PerformanceDataPoint & { x: number })[];
  minSpeed: number;
  maxSpeed: number;
  bestIndex: number;
  hasReverseRuns: boolean;
  summaryStats: ChartSummaryStats;
  forwardStats: DirectionSummaryStats | null;
  reverseStats: DirectionSummaryStats | null;
  bestForwardRecord: DirectionBestRecord | null;
  bestReverseRecord: DirectionBestRecord | null;
  sectionTimeRange: SectionTimeRange;
  bucketType: BucketType;
  showBucketModal: boolean;
  highlightedActivityId: string | null;
  onActivitySelect: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  onScrubChange: (scrubbing: boolean) => void;
  onTimeRangeChange: (range: SectionTimeRange) => void;
  onBucketTypeChange: (type: BucketType) => void;
  onShowBucketModal: (show: boolean) => void;
}

export function SectionPerformanceSection({
  isDark,
  section,
  useBucketedChart,
  bucketChartData,
  bucketMinSpeed,
  bucketMaxSpeed,
  bucketBestIndex,
  bucketHasReverseRuns,
  bucketSummaryStats,
  bucketForwardStats,
  bucketReverseStats,
  bucketBestForward,
  bucketBestReverse,
  bucketTotalTraversals,
  chartData,
  minSpeed,
  maxSpeed,
  bestIndex,
  hasReverseRuns,
  summaryStats,
  forwardStats,
  reverseStats,
  bestForwardRecord,
  bestReverseRecord,
  sectionTimeRange,
  bucketType,
  showBucketModal,
  highlightedActivityId,
  onActivitySelect,
  onScrubChange,
  onTimeRangeChange,
  onBucketTypeChange,
  onShowBucketModal,
}: SectionPerformanceSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      {useBucketedChart && bucketChartData.length >= 1 && (
        <View style={styles.chartSection}>
          <View style={styles.timeRangeRow}>
            <View style={styles.timeRangeWithButton}>
              <View style={styles.timeRangeContainer}>
                {SECTION_TIME_RANGES.map((range) => (
                  <TouchableOpacity
                    key={range.id}
                    style={[
                      styles.timeRangeButton,
                      isDark && styles.timeRangeButtonDark,
                      sectionTimeRange === range.id && styles.timeRangeButtonActive,
                    ]}
                    onPress={() => onTimeRangeChange(range.id)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.timeRangeText,
                        isDark && styles.timeRangeTextDark,
                        sectionTimeRange === range.id && styles.timeRangeTextActive,
                      ]}
                    >
                      {range.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.groupingButton, isDark && styles.groupingButtonDark]}
                onPress={() => onShowBucketModal(true)}
                activeOpacity={0.7}
              >
                <IconButton
                  icon="chart-timeline-variant"
                  iconColor={
                    bucketType !== DEFAULT_BUCKET_TYPE[sectionTimeRange]
                      ? colors.primary
                      : isDark
                        ? darkColors.textSecondary
                        : colors.textSecondary
                  }
                  size={18}
                  style={{ margin: 0 }}
                />
              </TouchableOpacity>
            </View>
            <Text style={[styles.bucketSubtitle, isDark && styles.textMuted]}>
              {t(BUCKET_TYPES.find((bt) => bt.id === bucketType)!.labelKey)}
              {' \u00b7 '}
              {t('sections.traversalsCount', { count: bucketTotalTraversals })}
            </Text>
          </View>
          <UnifiedPerformanceChart
            chartData={bucketChartData}
            activityType={section.sportType as ActivityType}
            isDark={isDark}
            minSpeed={bucketMinSpeed}
            maxSpeed={bucketMaxSpeed}
            bestIndex={bucketBestIndex}
            hasReverseRuns={bucketHasReverseRuns}
            tooltipBadgeType="time"
            onActivitySelect={onActivitySelect}
            onScrubChange={onScrubChange}
            selectedActivityId={highlightedActivityId}
            summaryStats={bucketSummaryStats ?? summaryStats}
            bestForwardRecord={bucketBestForward ?? bestForwardRecord}
            bestReverseRecord={bucketBestReverse ?? bestReverseRecord}
            forwardStats={bucketForwardStats ?? forwardStats}
            reverseStats={bucketReverseStats ?? reverseStats}
            linearTimeAxis
          />
        </View>
      )}
      {!useBucketedChart && chartData.length >= 1 && (
        <View style={styles.chartSection}>
          <UnifiedPerformanceChart
            chartData={chartData}
            activityType={section.sportType as ActivityType}
            isDark={isDark}
            minSpeed={minSpeed}
            maxSpeed={maxSpeed}
            bestIndex={bestIndex}
            hasReverseRuns={hasReverseRuns}
            tooltipBadgeType="time"
            onActivitySelect={onActivitySelect}
            onScrubChange={onScrubChange}
            selectedActivityId={highlightedActivityId}
            summaryStats={summaryStats}
            bestForwardRecord={bestForwardRecord}
            bestReverseRecord={bestReverseRecord}
            forwardStats={forwardStats}
            reverseStats={reverseStats}
          />
        </View>
      )}

      {showBucketModal && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => onShowBucketModal(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => onShowBucketModal(false)}>
            <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
              <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
                {t('sections.groupingTitle')}
              </Text>
              <Text style={[styles.modalDescription, isDark && styles.modalDescriptionDark]}>
                {t('sections.groupingDescription')}
              </Text>
              <View style={styles.groupingOptions}>
                {BUCKET_TYPES.map((bt) => (
                  <TouchableOpacity
                    key={bt.id}
                    style={[
                      styles.groupingOption,
                      isDark && styles.groupingOptionDark,
                      bucketType === bt.id && styles.groupingOptionActive,
                    ]}
                    onPress={() => {
                      onBucketTypeChange(bt.id);
                      onShowBucketModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.groupingOptionText,
                        isDark && styles.groupingOptionTextDark,
                        bucketType === bt.id && styles.groupingOptionTextActive,
                      ]}
                    >
                      {t(bt.labelKey)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  textMuted: {
    color: darkColors.textSecondary,
  },
  chartSection: {
    marginBottom: spacing.lg,
  },
  timeRangeRow: {
    marginBottom: spacing.sm,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  timeRangeButton: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  timeRangeButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  timeRangeButtonActive: {
    backgroundColor: colors.primary,
  },
  timeRangeText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  timeRangeTextDark: {
    color: darkColors.textSecondary,
  },
  timeRangeTextActive: {
    color: colors.textOnDark,
  },
  bucketSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  timeRangeWithButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  groupingButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupingButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: opacity.overlay.full,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius + 4,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 320,
  },
  modalContentDark: {
    backgroundColor: darkColors.surface,
  },
  modalTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  modalTitleDark: {
    color: darkColors.textPrimary,
  },
  modalDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  modalDescriptionDark: {
    color: darkColors.textSecondary,
  },
  groupingOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  groupingOption: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  groupingOptionDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  groupingOptionActive: {
    backgroundColor: colors.primary,
  },
  groupingOptionText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  groupingOptionTextDark: {
    color: darkColors.textSecondary,
  },
  groupingOptionTextActive: {
    color: colors.textOnDark,
  },
});
