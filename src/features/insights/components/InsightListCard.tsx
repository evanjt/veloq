import React, { useMemo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, Path, Circle } from '@shopify/react-native-skia';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  spacing,
  colorWithOpacity,
  brand,
  insightCategoryColors,
  layout,
  typography,
  insightToneColor,
  verdictColor,
} from '@/theme';
import { ChartErrorBoundary } from '@/shared/ui';
import { Card } from '@/shared/ui/Card';
import type { Insight } from '@/types';
import { getInlineMetric } from '../lib/inlineMetric';
import { TrackPreview, normalizeTrackPoints, type NormalisedPoint } from '@/shared/ui/TrackPreview';

interface InsightListCardProps {
  insight: Insight;
  onPress: (insight: Insight) => void;
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
const PREVIEW_H = 28;

/**
 * The section a PR card is about, as a thumbnail. A name like "Section 6"
 * says nothing about which stretch of road it is, and the engine hands the
 * line over with the record rather than the card reading geometry of its own.
 */
function getSectionPreview(
  insight: Insight
): { sectionId: string; points: NormalisedPoint[] } | null {
  if (insight.category !== 'section_pr') return null;
  const section = insight.supportingData?.sections?.[0];
  if (!section?.previewPoints) return null;
  const points = normalizeTrackPoints(section.previewPoints);
  return points.length >= 2 ? { sectionId: section.sectionId, points } : null;
}

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
      y: py + h - ((v - min) / range) * h,
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
      y: py + h - ((data[data.length - 1] - min) / range) * h,
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
  const categoryColor = insightCategoryColors[insight.category] ?? colors.primary;
  const metric = useMemo(() => getInlineMetric(insight), [insight]);
  const sparkData = useMemo(() => getSparklineData(insight), [insight]);
  const sectionPreview = useMemo(() => getSectionPreview(insight), [insight]);

  // The change's own verdict, never the sign of its string.
  const contextColor = verdictColor(metric?.contextRung ?? 'neutral', isDark);

  const handlePress = useCallback(() => onPress(insight), [onPress, insight]);

  return (
    <Card
      variant="raised"
      padding="none"
      style={{ flexDirection: 'row', alignItems: 'center' }}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={insight.title}
      testID={`insight-card-${insight.id}`}
    >
      <View style={[styles.colorBar, { backgroundColor: categoryColor }]} />
      <View style={[styles.iconCircle, { backgroundColor: colorWithOpacity(categoryColor, 0.1) }]}>
        <MaterialCommunityIcons
          name={insight.icon as keyof typeof MaterialCommunityIcons.glyphMap}
          size={15}
          color={insightToneColor(insight.iconTone, isDark)}
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
        {sectionPreview ? (
          <TrackPreview
            testID={`section-preview-${sectionPreview.sectionId}`}
            points={sectionPreview.points}
            color={categoryColor}
            isDark={isDark}
            width={SPARK_W}
            height={PREVIEW_H}
          />
        ) : sparkData ? (
          <MiniSparkline data={sparkData} color={categoryColor} />
        ) : null}
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
    </Card>
  );
});

const styles = StyleSheet.create({
  colorBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadiusFull,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
    marginVertical: spacing.xs,
  },
  textContainer: {
    flex: 1,
    marginLeft: spacing.xsPlus,
    marginRight: spacing.xs,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.bodyCompact.fontSize,
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
    borderRadius: layout.borderRadiusFull,
    backgroundColor: brand.tealLight,
  },
  subtitle: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
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
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metricValueDark: {
    color: darkColors.textPrimary,
  },
  metricContext: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
    marginTop: spacing.xxs,
  },
  chevron: {
    marginRight: spacing.sm,
  },
});
