/**
 * Performance chart section for the section detail page.
 * Uses a fixed-width scatter chart with LOESS trend lines.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SectionScatterChart } from './SectionScatterChart';
import type { DirectionSummaryStats } from '@/components/routes/performance';
import { SECTION_TIME_RANGES, type SectionTimeRange } from '@/constants';
import { brand, colors, darkColors, spacing, typography } from '@/theme';
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
  chartData: (PerformanceDataPoint & { x: number })[];
  forwardStats: DirectionSummaryStats | null;
  reverseStats: DirectionSummaryStats | null;
  bestForwardRecord: DirectionBestRecord | null;
  bestReverseRecord: DirectionBestRecord | null;
  onActivitySelect: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  onScrubChange?: (scrubbing: boolean) => void;
  onExcludeActivity?: (activityId: string) => void;
  onIncludeActivity?: (activityId: string) => void;
  onSetAsReference?: (activityId: string) => void;
  referenceActivityId?: string;
  showExcluded?: boolean;
  hasExcluded?: boolean;
  onToggleShowExcluded?: () => void;
  highlightedActivityId?: string;
  sectionTimeRange: SectionTimeRange;
  onTimeRangeChange: (range: SectionTimeRange) => void;
}

export function SectionPerformanceSection({
  isDark,
  section,
  chartData,
  forwardStats,
  reverseStats,
  bestForwardRecord,
  bestReverseRecord,
  onActivitySelect,
  onScrubChange,
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
}: SectionPerformanceSectionProps) {
  const { t } = useTranslation();

  if (chartData.length < 1) return null;

  return (
    <View style={styles.chartSection}>
      <View style={styles.chartHeader}>
        <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]}>
          {t('sections.performanceOverTime')}
        </Text>
        <View style={styles.timeRangePills}>
          {SECTION_TIME_RANGES.map((r) => (
            <Pressable
              key={r.id}
              testID={`section-time-range-${r.id}`}
              onPress={() => onTimeRangeChange(r.id)}
              style={[
                styles.pill,
                sectionTimeRange === r.id && [
                  styles.pillActive,
                  isDark && { backgroundColor: darkColors.primary + '20' },
                ],
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  isDark && { color: darkColors.textSecondary },
                  sectionTimeRange === r.id && {
                    color: isDark ? darkColors.primary : colors.primary,
                  },
                ]}
              >
                {r.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <SectionScatterChart
        chartData={chartData}
        activityType={section.sportType as ActivityType}
        isDark={isDark}
        bestForwardRecord={bestForwardRecord}
        bestReverseRecord={bestReverseRecord}
        forwardStats={forwardStats}
        reverseStats={reverseStats}
        onActivitySelect={onActivitySelect}
        onScrubChange={onScrubChange}
        onExcludeActivity={onExcludeActivity}
        onIncludeActivity={onIncludeActivity}
        onSetAsReference={onSetAsReference}
        referenceActivityId={referenceActivityId}
        showExcluded={showExcluded}
        hasExcluded={hasExcluded}
        onToggleShowExcluded={onToggleShowExcluded}
        highlightedActivityId={highlightedActivityId}
      />
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { borderColor: brand.gold, borderWidth: 2 }]} />
          <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
            {t('sections.legendPr')}
          </Text>
        </View>
        {bestReverseRecord ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: colors.reverseDirection }]} />
            <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
              {t('sections.legendReverse')}
            </Text>
          </View>
        ) : null}
        {highlightedActivityId ? (
          <View style={styles.legendItem}>
            <View
              style={[styles.legendSwatch, { borderColor: colors.chartGreen, borderWidth: 2 }]}
            />
            <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
              {t('sections.legendThisActivity')}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartSection: {
    marginBottom: spacing.lg,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  chartTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chartTitleDark: {
    color: darkColors.textPrimary,
  },
  timeRangePills: {
    flexDirection: 'row',
    gap: 2,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pillActive: {
    backgroundColor: colors.primary + '20',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.primary,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  legendTextDark: {
    color: darkColors.textSecondary,
  },
});
