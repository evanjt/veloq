import React, { memo, useCallback } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import { formatDistance } from '@/lib';
import { SectionScatterChart } from '@/components/section/SectionScatterChart';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import type { DirectionBestRecord, DirectionSummaryStats } from '@/components/routes/performance';

export interface InlineSectionData {
  chartData: (PerformanceDataPoint & { x: number })[];
  bestForwardRecord: DirectionBestRecord | null;
  bestReverseRecord: DirectionBestRecord | null;
  forwardStats: DirectionSummaryStats | null;
  reverseStats: DirectionSummaryStats | null;
  activityType: ActivityType;
}

interface SectionInlinePlotProps {
  sectionId: string;
  sectionName: string;
  sectionType: string;
  distance: number;
  visitCount: number;
  index: number;
  style: { color: string };
  isHighlighted: boolean;
  isDark: boolean;
  isMetric: boolean;
  plotData: InlineSectionData | undefined;
  onPress: (sectionId: string) => void;
  onLongPress: (sectionId: string) => void;
  onSwipeableOpen: (sectionId: string) => void;
  renderRightActions: (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => React.ReactNode;
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable | null>>;
}

export const SectionInlinePlot = memo(
  function SectionInlinePlot({
    sectionId,
    sectionName,
    sectionType,
    distance,
    visitCount,
    index,
    style,
    isHighlighted,
    isDark,
    isMetric,
    plotData,
    onPress,
    onLongPress,
    onSwipeableOpen,
    renderRightActions,
    swipeableRefs,
  }: SectionInlinePlotProps) {
    const { t } = useTranslation();

    const handleLongPress = useCallback(() => {
      onLongPress?.(sectionId);
    }, [onLongPress, sectionId]);

    const handlePress = useCallback(() => {
      onPress?.(sectionId);
    }, [onPress, sectionId]);

    return (
      <View>
        <Swipeable
          ref={(ref) => {
            swipeableRefs.current.set(sectionId, ref);
          }}
          renderRightActions={renderRightActions}
          onSwipeableOpen={() => onSwipeableOpen(sectionId)}
          overshootRight={false}
          friction={2}
        >
          <Pressable
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
            style={({ pressed }) => [
              styles.card,
              isDark && styles.cardDark,
              isHighlighted && styles.cardHighlighted,
              pressed && Platform.OS === 'ios' && { opacity: 0.7 },
            ]}
          >
            {/* Header row */}
            <View style={styles.header}>
              <View style={[styles.numberBadge, { borderColor: style.color }]}>
                <Text style={styles.numberBadgeText}>{index + 1}</Text>
              </View>
              <View style={styles.headerInfo}>
                <View style={styles.nameRow}>
                  <Text style={[styles.name, isDark && styles.textLight]} numberOfLines={1}>
                    {sectionName}
                  </Text>
                  <View
                    style={[
                      sectionType === 'custom' ? styles.customBadge : styles.autoBadge,
                      isDark &&
                        (sectionType === 'custom' ? styles.customBadgeDark : styles.autoBadgeDark),
                    ]}
                  >
                    <Text
                      style={
                        sectionType === 'custom' ? styles.customBadgeText : styles.autoBadgeText
                      }
                    >
                      {sectionType === 'custom' ? t('routes.custom') : t('routes.autoDetected')}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.meta, isDark && styles.textMuted]}>
                  {formatDistance(distance, isMetric)} · {visitCount} {t('routes.visits')}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={isDark ? '#555' : '#CCC'}
              />
            </View>

            {/* Inline scatter chart */}
            {plotData && plotData.chartData.length >= 1 && (
              <SectionScatterChart
                chartData={plotData.chartData}
                activityType={plotData.activityType}
                isDark={isDark}
                bestForwardRecord={plotData.bestForwardRecord}
                bestReverseRecord={plotData.bestReverseRecord}
                forwardStats={plotData.forwardStats}
                reverseStats={plotData.reverseStats}
                compact
              />
            )}
          </Pressable>
        </Swipeable>
      </View>
    );
  },
  (prev, next) => {
    return (
      prev.isHighlighted === next.isHighlighted &&
      prev.plotData === next.plotData &&
      prev.isDark === next.isDark &&
      prev.sectionName === next.sectionName
    );
  }
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  cardHighlighted: {
    backgroundColor: colors.chartGold + '26',
    borderColor: colors.chartGold,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    paddingBottom: 0,
  },
  numberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  numberBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  name: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.xs,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  meta: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  customBadge: {
    backgroundColor: colors.primary + '1A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  customBadgeDark: {
    backgroundColor: darkColors.primary + '33',
  },
  customBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primary,
  },
  autoBadge: {
    backgroundColor: colors.chartCyan + '1A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  autoBadgeDark: {
    backgroundColor: colors.chartCyan + '33',
  },
  autoBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.chartCyan,
  },
});
