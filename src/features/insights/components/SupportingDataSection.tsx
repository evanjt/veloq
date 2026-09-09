import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Canvas, Path, LinearGradient, vec } from '@shopify/react-native-skia';
import { useTranslation } from 'react-i18next';
import { navigateTo } from '@/shared/app/navigation';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, opacity, shadows, ink, layout, typography } from '@/theme';
import { DataPointRow } from './DataPointRow';
import { formatDuration } from '@/shared/format/format';
import type { InsightSupportingData } from '@/types';

const SPARKLINE_HEIGHT = 60;

interface SupportingDataSectionProps {
  data: InsightSupportingData;
}

function getTrendIcon(trend?: number): string {
  if (trend == null) return 'minus';
  if (trend > 0) return 'trending-up';
  if (trend < 0) return 'trending-down';
  return 'minus';
}

function getTrendColor(trend?: number, isDark?: boolean): string {
  if (trend == null) return isDark ? darkColors.textSecondary : colors.textSecondary;
  if (trend > 0) return colors.success;
  if (trend < 0) return colors.warning;
  return isDark ? darkColors.textSecondary : colors.textSecondary;
}

function computeSparklineTrend(data: number[]): { direction: string; change: string } {
  if (data.length < 2) return { direction: 'minus', change: '0%' };
  const first = data[0];
  const last = data[data.length - 1];
  if (first === 0) return { direction: last > 0 ? 'trending-up' : 'minus', change: '--' };
  const pct = ((last - first) / Math.abs(first)) * 100;
  const direction = pct > 0 ? 'trending-up' : pct < 0 ? 'trending-down' : 'minus';
  return { direction, change: `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%` };
}

function buildSparklinePath(
  data: number[],
  width: number,
  height: number,
  padding: number
): string {
  if (data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const drawH = height - padding * 2;
  const stepX = width / (data.length - 1);

  const points = data.map((v, i) => ({
    x: i * stepX,
    y: padding + drawH - ((v - min) / range) * drawH,
  }));

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

function buildSparklineAreaPath(
  data: number[],
  width: number,
  height: number,
  padding: number
): string {
  const linePath = buildSparklinePath(data, width, height, padding);
  if (!linePath) return '';
  const stepX = width / (data.length - 1);
  const lastX = (data.length - 1) * stepX;
  return `${linePath} L ${lastX} ${height} L 0 ${height} Z`;
}

export const SupportingDataSection = React.memo(function SupportingDataSection({
  data,
}: SupportingDataSectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const dataPoints = data.dataPoints?.length ? data.dataPoints : null;
  const sparkline =
    data.sparklineData && data.sparklineData.length >= 2 ? data.sparklineData : null;
  const comparison = data.comparisonData ?? null;
  const sections = data.sections?.length ? data.sections : null;

  const sparklineTrend = useMemo(
    () => (sparkline ? computeSparklineTrend(sparkline) : null),
    [sparkline]
  );

  const trendColor = useMemo(() => {
    if (!sparklineTrend) return colors.success;
    if (sparklineTrend.direction === 'trending-up') return colors.success;
    if (sparklineTrend.direction === 'trending-down') return colors.error;
    return isDark ? darkColors.textSecondary : colors.textSecondary;
  }, [sparklineTrend, isDark]);

  return (
    <View style={styles.container}>
      {/* Data Points */}
      {dataPoints
        ? dataPoints.map((dp, i) => <DataPointRow key={`dp-${i}`} dataPoint={dp} />)
        : null}

      {/* Sparkline - Skia Canvas with gradient fill */}
      {sparkline ? (
        <View style={[styles.sparklineCard, isDark && styles.sparklineCardDark]}>
          <View style={styles.sparklineHeader}>
            {data.sparklineLabel ? (
              <Text style={[styles.sparklineLabel, isDark && styles.sparklineLabelDark]}>
                {data.sparklineLabel}
              </Text>
            ) : null}
            {sparklineTrend ? (
              <View style={styles.sparklineTrend}>
                <MaterialCommunityIcons
                  name={sparklineTrend.direction as never}
                  size={18}
                  color={trendColor}
                />
                <Text
                  style={[
                    styles.sparklineChange,
                    sparklineTrend.direction === 'trending-up' && styles.sparklinePositive,
                    sparklineTrend.direction === 'trending-down' && styles.sparklineNegative,
                  ]}
                >
                  {sparklineTrend.change}
                </Text>
              </View>
            ) : null}
          </View>
          <SparklineChart data={sparkline} color={trendColor} />
        </View>
      ) : null}

      {/* Comparison Card */}
      {comparison ? (
        <View
          style={[
            styles.comparisonCard,
            isDark && styles.comparisonCardDark,
            comparison.change.context === 'good' && styles.comparisonPositive,
            comparison.change.context === 'concern' && styles.comparisonNegative,
          ]}
        >
          <View style={styles.comparisonColumns}>
            <View style={styles.comparisonColumn}>
              <Text style={[styles.comparisonHeader, isDark && styles.comparisonHeaderDark]}>
                {t('insights.current', 'Current')}
              </Text>
              <Text style={[styles.comparisonValue, isDark && styles.comparisonValueDark]}>
                {String(comparison.current.value)}
                {comparison.current.unit ? ` ${comparison.current.unit}` : ''}
              </Text>
              <Text style={[styles.comparisonLabel, isDark && styles.comparisonLabelDark]}>
                {comparison.current.label}
              </Text>
            </View>
            <View style={styles.comparisonDivider} />
            <View style={styles.comparisonColumn}>
              <Text style={[styles.comparisonHeader, isDark && styles.comparisonHeaderDark]}>
                {t('insights.previous', 'Previous')}
              </Text>
              <Text style={[styles.comparisonValue, isDark && styles.comparisonValueDark]}>
                {String(comparison.previous.value)}
                {comparison.previous.unit ? ` ${comparison.previous.unit}` : ''}
              </Text>
              <Text style={[styles.comparisonLabel, isDark && styles.comparisonLabelDark]}>
                {comparison.previous.label}
              </Text>
            </View>
          </View>
          <View style={styles.comparisonChange}>
            <MaterialCommunityIcons
              name={
                comparison.change.context === 'good'
                  ? 'arrow-up'
                  : comparison.change.context === 'concern'
                    ? 'arrow-down'
                    : ('minus' as never)
              }
              size={16}
              color={
                comparison.change.context === 'good'
                  ? colors.success
                  : comparison.change.context === 'concern'
                    ? colors.error
                    : isDark
                      ? darkColors.textSecondary
                      : colors.textSecondary
              }
            />
            <Text
              style={[
                styles.comparisonChangeText,
                comparison.change.context === 'good' && styles.changePositive,
                comparison.change.context === 'concern' && styles.changeNegative,
              ]}
            >
              {String(comparison.change.value)}
              {comparison.change.unit ? ` ${comparison.change.unit}` : ''}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Section Links */}
      {sections ? (
        <View style={styles.sectionsContainer}>
          {sections.map((section) => (
            <Pressable
              key={section.sectionId}
              style={[styles.sectionCard, isDark && styles.sectionCardDark]}
              onPress={() => navigateTo(`/section/${section.sectionId}`)}
            >
              <View style={styles.sectionContent}>
                <Text
                  style={[styles.sectionName, isDark && styles.sectionNameDark]}
                  numberOfLines={1}
                >
                  {section.sectionName}
                </Text>
                <View style={styles.sectionMeta}>
                  {section.bestTime != null ? (
                    <Text style={[styles.sectionBestTime, isDark && styles.sectionBestTimeDark]}>
                      {formatDuration(section.bestTime)}
                    </Text>
                  ) : null}
                  {section.traversalCount != null ? (
                    <Text
                      style={[styles.sectionTraversals, isDark && styles.sectionTraversalsDark]}
                    >
                      {section.traversalCount}x
                    </Text>
                  ) : null}
                  <MaterialCommunityIcons
                    name={getTrendIcon(section.trend) as never}
                    size={16}
                    color={getTrendColor(section.trend, isDark)}
                  />
                </View>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={18}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
});

/** Inline Skia sparkline with gradient fill */
const SparklineChart = React.memo(function SparklineChart({
  data,
  color,
}: {
  data: number[];
  color: string;
}) {
  const WIDTH = 280;
  const PADDING = 4;

  const linePath = useMemo(
    () => buildSparklinePath(data, WIDTH, SPARKLINE_HEIGHT, PADDING),
    [data]
  );
  const areaPath = useMemo(
    () => buildSparklineAreaPath(data, WIDTH, SPARKLINE_HEIGHT, PADDING),
    [data]
  );

  if (!linePath) return null;

  return (
    <Canvas style={{ width: WIDTH, height: SPARKLINE_HEIGHT }}>
      <Path path={areaPath} style="fill">
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, SPARKLINE_HEIGHT)}
          colors={[`${color}40`, `${color}05`]}
        />
      </Path>
      <Path path={linePath} style="stroke" strokeWidth={2} color={color} />
    </Canvas>
  );
});

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
  },
  // Sparkline
  sparklineCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  sparklineCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  sparklineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sparklineLabel: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  sparklineLabelDark: {
    color: darkColors.textSecondary,
  },
  sparklineTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sparklineChange: {
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sparklinePositive: {
    color: colors.success,
  },
  sparklineNegative: {
    color: colors.error,
  },
  // Comparison
  comparisonCard: {
    borderRadius: layout.borderRadiusMd,
    padding: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: opacity.overlay.subtle,
  },
  comparisonCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  comparisonPositive: {
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
  },
  comparisonNegative: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  comparisonColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  comparisonColumn: {
    flex: 1,
    alignItems: 'center',
  },
  comparisonDivider: {
    width: 1,
    height: 48,
    backgroundColor: opacity.overlay.light,
    marginHorizontal: spacing.sm,
  },
  comparisonHeader: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  comparisonHeaderDark: {
    color: darkColors.textSecondary,
  },
  comparisonValue: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  comparisonValueDark: {
    color: darkColors.textPrimary,
  },
  comparisonLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  comparisonLabelDark: {
    color: darkColors.textSecondary,
  },
  comparisonChange: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  comparisonChangeText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  changePositive: {
    color: colors.success,
  },
  changeNegative: {
    color: colors.error,
  },
  // Sections
  sectionsContainer: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ink.white,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  sectionCardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  sectionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: spacing.xs,
  },
  sectionName: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionBestTime: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sectionBestTimeDark: {
    color: darkColors.textPrimary,
  },
  sectionTraversals: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  sectionTraversalsDark: {
    color: darkColors.textSecondary,
  },
});
