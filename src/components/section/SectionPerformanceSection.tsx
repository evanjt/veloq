/**
 * Performance chart section for the section detail page.
 * Uses a fixed-width scatter chart with LOESS trend lines.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SectionScatterChart } from './SectionScatterChart';
import type { DirectionSummaryStats } from '@/components/routes/performance';
import { spacing } from '@/theme';
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
  showExcluded?: boolean;
  hasExcluded?: boolean;
  onToggleShowExcluded?: () => void;
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
  showExcluded,
  hasExcluded,
  onToggleShowExcluded,
}: SectionPerformanceSectionProps) {
  if (chartData.length < 1) return null;

  return (
    <View style={styles.chartSection}>
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
        showExcluded={showExcluded}
        hasExcluded={hasExcluded}
        onToggleShowExcluded={onToggleShowExcluded}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chartSection: {
    marginBottom: spacing.lg,
  },
});
