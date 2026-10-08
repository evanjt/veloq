import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import type { FfiAttemptHistograms, FfiSectionTrendCurves } from 'veloqrs';
import type { ActivityType, PerformanceDataPoint, RoutePoint } from '@/types';
import { PerformanceChartPanel } from './section';
import { ExcludedActivitiesToggle } from './section/SectionScatterChart';
import type { SectionScatterChartProps } from './section';
import { styles } from './RouteDetailScreen.styles';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

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
  const { t } = useTranslation();

  return (
    <View testID="route-detail-chart" style={styles.chartSection}>
      <Text
        testID="route-time-method"
        style={{
          marginBottom: spacing.sm,
          fontSize: typography.caption.fontSize,
          color: isDark ? darkColors.textSecondary : colors.textSecondary,
        }}
      >
        {t('routes.timeMethod')}
      </Text>

      {chartData.length === 0 ? (
        <View
          testID="route-detail-chart-empty"
          style={[emptyStyles.frame, isDark && emptyStyles.frameDark]}
        >
          {hasExcluded && (
            <ExcludedActivitiesToggle
              isDark={isDark}
              showExcluded={showExcluded}
              onToggle={onToggleShowExcluded}
            />
          )}
          <Text style={[emptyStyles.text, isDark && emptyStyles.textDark]}>
            {t('sections.noActivitiesFound')}
          </Text>
        </View>
      ) : (
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
      )}
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  frame: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    paddingVertical: spacing.md,
  },
  frameDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  text: {
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
