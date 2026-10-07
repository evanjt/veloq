import { View } from 'react-native';

import type { FfiAttemptHistograms, FfiSectionTrendCurves } from 'veloqrs';
import type { ActivityType, PerformanceDataPoint, RoutePoint } from '@/types';
import { PerformanceChartPanel } from './section';
import type { SectionScatterChartProps } from './section';
import { styles } from './RouteDetailScreen.styles';

interface RouteDetailChartProps {
  chartData: (PerformanceDataPoint & { x: number })[];
  trendCurves: FfiSectionTrendCurves;
  histograms?: FfiAttemptHistograms | undefined;
  activityType: ActivityType;
  isDark: boolean;
  bestForwardRecord: SectionScatterChartProps['bestForwardRecord'];
  bestReverseRecord: SectionScatterChartProps['bestReverseRecord'];
  bestForwardIsRecord: boolean;
  bestReverseIsRecord: boolean;
  forwardStats: SectionScatterChartProps['forwardStats'];
  reverseStats: SectionScatterChartProps['reverseStats'];
  onActivitySelect: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  onExcludeActivity: (activityId: string) => void;
  onIncludeActivity: (activityId: string) => void;
  onSetAsReference: (activityId: string) => void;
  referenceActivityId: SectionScatterChartProps['referenceActivityId'];
  showExcluded: boolean;
  hasExcluded: boolean;
  onToggleShowExcluded: () => void;
  highlightedActivityId?: string | undefined;
}

export function RouteDetailChart({
  chartData,
  trendCurves,
  histograms,
  activityType,
  isDark,
  bestForwardRecord,
  bestReverseRecord,
  bestForwardIsRecord,
  bestReverseIsRecord,
  forwardStats,
  reverseStats,
  onActivitySelect,
  onExcludeActivity,
  onIncludeActivity,
  onSetAsReference,
  referenceActivityId,
  showExcluded,
  hasExcluded,
  onToggleShowExcluded,
  highlightedActivityId,
}: RouteDetailChartProps) {
  return (
    <View testID="route-detail-chart" style={styles.chartSection}>
      <PerformanceChartPanel
        histograms={histograms}
        chartData={chartData}
        trendCurves={trendCurves}
        activityType={activityType}
        isDark={isDark}
        useTimeAxis
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
    </View>
  );
}
