import React, { useMemo, useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, Path, Circle } from '@shopify/react-native-skia';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, shadows, colorWithOpacity } from '@/theme';
import { ChartErrorBoundary } from '@/components/ui';
import type { Insight } from '@/types';

const CATEGORY_COLORS: Record<string, string> = {
  section_pr: '#FFD700',
  fitness_milestone: '#4CAF50',
  period_comparison: '#2196F3',
  strength_progression: '#F97316',
  strength_balance: '#EF4444',
  hrv_trend: '#66BB6A',
  tsb_form: '#42A5F5',
  intensity_context: '#FFA726',
  stale_pr: '#FF9800',
  section_cluster: '#66BB6A',
  efficiency_trend: '#66BB6A',
};

interface InsightListCardProps {
  insight: Insight;
  onPress: (insight: Insight) => void;
}

/** Extract the primary metric value + unit from an insight for inline display */
function getInlineMetric(insight: Insight): { value: string; context?: string } | null {
  const dp = insight.supportingData?.dataPoints;
  const comp = insight.supportingData?.comparisonData;

  switch (insight.category) {
    case 'fitness_milestone': {
      if (dp && dp.length >= 1) {
        const cur = dp[0];
        const change = dp[2];
        return {
          value: `${cur.value}${cur.unit ? ` ${cur.unit}` : ''}`,
          context: change ? String(change.value) : undefined,
        };
      }
      return null;
    }
    case 'tsb_form': {
      if (dp && dp.length >= 1) {
        const tsb = dp.find((d) => d.label.toLowerCase().includes('tsb'));
        if (tsb) return { value: String(tsb.value) };
      }
      return null;
    }
    case 'hrv_trend': {
      if (dp && dp.length >= 1) {
        return {
          value: `${dp[0].value}${dp[0].unit ? ` ${dp[0].unit}` : ''}`,
        };
      }
      return null;
    }
    case 'period_comparison': {
      if (comp) {
        return {
          value: String(comp.change.value),
        };
      }
      return null;
    }
    case 'strength_progression': {
      if (comp) {
        return {
          value: String(comp.change.value),
        };
      }
      return null;
    }
    case 'strength_balance': {
      const ratioPoint = dp?.find((d) => d.label === 'Ratio');
      if (ratioPoint) {
        return {
          value: String(ratioPoint.value),
        };
      }
      return null;
    }
    case 'section_pr': {
      const sections = insight.supportingData?.sections;
      if (sections && sections.length > 0 && sections[0].bestTime != null) {
        const secs = sections[0].bestTime;
        const m = Math.floor(secs / 60);
        const s = Math.round(secs % 60);
        return { value: `${m}:${s.toString().padStart(2, '0')}` };
      }
      return null;
    }
    case 'efficiency_trend': {
      const hrPoint = dp?.find((d) => d.unit === 'bpm');
      if (hrPoint) {
        return { value: `${hrPoint.value} bpm`, context: undefined };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Build a tiny sparkline path from sparkline data or data points */
function getSparklineData(insight: Insight): number[] | null {
  if (insight.supportingData?.sparklineData && insight.supportingData.sparklineData.length >= 3) {
    return insight.supportingData.sparklineData;
  }
  return null;
}

const SPARK_W = 48;
const SPARK_H = 20;

const MiniSparkline = React.memo(function MiniSparkline({
  data,
  color,
}: {
  data: number[];
  color: string;
}) {
  const pathStr = useMemo(() => {
    if (data.length < 2) return '';
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const px = 2;
    const py = 2;
    const w = SPARK_W - px * 2;
    const h = SPARK_H - py * 2;
    const points = data.map((v, i) => ({
      x: px + (i / (data.length - 1)) * w,
      y: py + ((v - min) / range) * h,
    }));
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  }, [data]);

  const lastDot = useMemo(() => {
    if (data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const px = 2;
    const py = 2;
    const w = SPARK_W - px * 2;
    const h = SPARK_H - py * 2;
    return {
      x: px + w,
      y: py + ((data[data.length - 1] - min) / range) * h,
    };
  }, [data]);

  if (!pathStr) return null;

  return (
    <ChartErrorBoundary height={SPARK_H}>
      <Canvas style={{ width: SPARK_W, height: SPARK_H }}>
        <Path path={pathStr} style="stroke" strokeWidth={1.5} color={`${color}80`} />
        {lastDot ? <Circle cx={lastDot.x} cy={lastDot.y} r={2.5} color={color} /> : null}
      </Canvas>
    </ChartErrorBoundary>
  );
});

export const InsightListCard = React.memo(function InsightListCard({
  insight,
  onPress,
}: InsightListCardProps) {
  const { isDark } = useTheme();
  const categoryColor = CATEGORY_COLORS[insight.category] ?? colors.primary;
  const metric = useMemo(() => getInlineMetric(insight), [insight]);
  const sparkData = useMemo(() => getSparklineData(insight), [insight]);

  const contextColor =
    metric?.context == null
      ? colors.warning
      : metric.context.startsWith('+')
        ? colors.success
        : colors.warning;

  const handlePress = useCallback(() => onPress(insight), [onPress, insight]);

  return (
    <TouchableOpacity
      style={[styles.card, isDark && styles.cardDark]}
      onPress={handlePress}
      activeOpacity={0.7}
      testID={`insight-card-${insight.id}`}
    >
      <View style={[styles.colorBar, { backgroundColor: categoryColor }]} />
      <View style={[styles.iconCircle, { backgroundColor: colorWithOpacity(categoryColor, 0.1) }]}>
        <MaterialCommunityIcons
          name={insight.icon as keyof typeof MaterialCommunityIcons.glyphMap}
          size={15}
          color={insight.iconColor}
        />
      </View>
      <View style={styles.textContainer}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, isDark && styles.titleDark]} numberOfLines={1}>
            {insight.title}
          </Text>
          {insight.isNew ? <View style={styles.newDot} /> : null}
        </View>
        {insight.subtitle ? (
          <Text style={[styles.subtitle, isDark && styles.subtitleDark]} numberOfLines={1}>
            {insight.subtitle}
          </Text>
        ) : null}
      </View>

      {/* Inline data preview: metric value + optional sparkline */}
      <View style={styles.dataPreview}>
        {sparkData ? <MiniSparkline data={sparkData} color={categoryColor} /> : null}
        {metric ? (
          <View style={styles.metricContainer}>
            <Text style={[styles.metricValue, isDark && styles.metricValueDark]} numberOfLines={1}>
              {metric.value}
            </Text>
            {metric.context ? (
              <Text style={[styles.metricContext, { color: contextColor }]} numberOfLines={1}>
                {metric.context}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <MaterialCommunityIcons
        name="chevron-right"
        size={16}
        color={isDark ? darkColors.textMuted : colors.textMuted}
        style={styles.chevron}
      />
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginHorizontal: spacing.md,
    marginBottom: 2,
    overflow: 'hidden',
    ...shadows.card,
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderWidth: 1,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  colorBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
    marginVertical: 5,
  },
  textContainer: {
    flex: 1,
    marginLeft: 6,
    marginRight: spacing.xs,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  newDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FC4C02',
  },
  subtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  // Inline data preview (right side of card)
  dataPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginRight: spacing.xs,
  },
  metricContainer: {
    alignItems: 'flex-end',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metricValueDark: {
    color: darkColors.textPrimary,
  },
  metricContext: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  chevron: {
    marginRight: spacing.sm,
  },
});
