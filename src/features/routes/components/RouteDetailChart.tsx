import { View } from 'react-native';

import type { ActivityType, PerformanceDataPoint, RoutePoint } from '@/types';
import { SectionScatterChart } from './section';
import type { SectionScatterChartProps } from './section';
import { styles } from './RouteDetailScreen.styles';

interface RouteDetailChartProps {
  chartData: (PerformanceDataPoint & { x: number })[];
  activityType: ActivityType;
  isDark: boolean;
  bestForwardRecord: SectionScatterChartProps['bestForwardRecord'];
  bestReverseRecord: SectionScatterChartProps['bestReverseRecord'];
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
  highlightedActivityId?: string;
}

export function RouteDetailChart({
  chartData,
  activityType,
  isDark,
  bestForwardRecord,
  bestReverseRecord,
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
      <SectionScatterChart
        chartData={chartData}
        activityType={activityType}
        isDark={isDark}
        useTimeAxis
        bestForwardRecord={bestForwardRecord}
        bestReverseRecord={bestReverseRecord}
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
