import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity, shadows } from '@/theme';
import { DataPointRow } from './DataPointRow';
import type { InsightSupportingData } from '@/types';

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

export const SupportingDataSection = React.memo(function SupportingDataSection({
  data,
}: SupportingDataSectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  const hasDataPoints = data.dataPoints && data.dataPoints.length > 0;
  const hasSparkline = data.sparklineData && data.sparklineData.length > 0;
  const hasComparison = data.comparisonData != null;
  const hasSections = data.sections && data.sections.length > 0;

  return (
    <View style={styles.container}>
      {/* Data Points */}
      {hasDataPoints
        ? data.dataPoints!.map((dp, i) => <DataPointRow key={`dp-${i}`} dataPoint={dp} />)
        : null}

      {/* Sparkline (text-based trend representation) */}
      {hasSparkline ? (
        <View style={[styles.sparklineCard, isDark && styles.sparklineCardDark]}>
          {data.sparklineLabel ? (
            <Text style={[styles.sparklineLabel, isDark && styles.sparklineLabelDark]}>
              {data.sparklineLabel}
            </Text>
          ) : null}
          {(() => {
            const trend = computeSparklineTrend(data.sparklineData!);
            return (
              <View style={styles.sparklineTrend}>
                <MaterialCommunityIcons
                  name={trend.direction as never}
                  size={20}
                  color={
                    trend.direction === 'trending-up'
                      ? colors.success
                      : trend.direction === 'trending-down'
                        ? colors.error
                        : isDark
                          ? darkColors.textSecondary
                          : colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.sparklineChange,
                    trend.direction === 'trending-up' && styles.sparklinePositive,
                    trend.direction === 'trending-down' && styles.sparklineNegative,
                  ]}
                >
                  {trend.change}
                </Text>
              </View>
            );
          })()}
        </View>
      ) : null}

      {/* Comparison Card */}
      {hasComparison ? (
        <View
          style={[
            styles.comparisonCard,
            isDark && styles.comparisonCardDark,
            data.comparisonData!.change.context === 'good' && styles.comparisonPositive,
            data.comparisonData!.change.context === 'concern' && styles.comparisonNegative,
          ]}
        >
          <View style={styles.comparisonColumns}>
            <View style={styles.comparisonColumn}>
              <Text style={[styles.comparisonHeader, isDark && styles.comparisonHeaderDark]}>
                {t('insights.current', 'Current')}
              </Text>
              <Text style={[styles.comparisonValue, isDark && styles.comparisonValueDark]}>
                {String(data.comparisonData!.current.value)}
                {data.comparisonData!.current.unit ? ` ${data.comparisonData!.current.unit}` : ''}
              </Text>
              <Text style={[styles.comparisonLabel, isDark && styles.comparisonLabelDark]}>
                {data.comparisonData!.current.label}
              </Text>
            </View>
            <View style={styles.comparisonDivider} />
            <View style={styles.comparisonColumn}>
              <Text style={[styles.comparisonHeader, isDark && styles.comparisonHeaderDark]}>
                {t('insights.previous', 'Previous')}
              </Text>
              <Text style={[styles.comparisonValue, isDark && styles.comparisonValueDark]}>
                {String(data.comparisonData!.previous.value)}
                {data.comparisonData!.previous.unit ? ` ${data.comparisonData!.previous.unit}` : ''}
              </Text>
              <Text style={[styles.comparisonLabel, isDark && styles.comparisonLabelDark]}>
                {data.comparisonData!.previous.label}
              </Text>
            </View>
          </View>
          <View style={styles.comparisonChange}>
            <MaterialCommunityIcons
              name={
                data.comparisonData!.change.context === 'good'
                  ? 'arrow-up'
                  : data.comparisonData!.change.context === 'concern'
                    ? 'arrow-down'
                    : ('minus' as never)
              }
              size={16}
              color={
                data.comparisonData!.change.context === 'good'
                  ? colors.success
                  : data.comparisonData!.change.context === 'concern'
                    ? colors.error
                    : isDark
                      ? darkColors.textSecondary
                      : colors.textSecondary
              }
            />
            <Text
              style={[
                styles.comparisonChangeText,
                data.comparisonData!.change.context === 'good' && styles.changePositive,
                data.comparisonData!.change.context === 'concern' && styles.changeNegative,
              ]}
            >
              {String(data.comparisonData!.change.value)}
              {data.comparisonData!.change.unit ? ` ${data.comparisonData!.change.unit}` : ''}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Section Links */}
      {hasSections ? (
        <View style={styles.sectionsContainer}>
          {data.sections!.map((section) => (
            <Pressable
              key={section.sectionId}
              style={[styles.sectionCard, isDark && styles.sectionCardDark]}
              onPress={() => router.push(`/section/${section.sectionId}` as never)}
            >
              <View style={styles.sectionContent}>
                <Text
                  style={[styles.sectionName, isDark && styles.sectionNameDark]}
                  numberOfLines={1}
                >
                  {section.sectionName}
                </Text>
                <View style={styles.sectionMeta}>
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

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
  },
  // Sparkline
  sparklineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  sparklineCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  sparklineLabel: {
    fontSize: 13,
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
    fontSize: 15,
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
    borderRadius: 12,
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
    fontSize: 11,
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
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  comparisonValueDark: {
    color: darkColors.textPrimary,
  },
  comparisonLabel: {
    fontSize: 12,
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
    fontSize: 14,
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
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
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
    fontSize: 14,
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
  sectionTraversals: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  sectionTraversalsDark: {
    color: darkColors.textSecondary,
  },
});
