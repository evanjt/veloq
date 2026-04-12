import React, { memo, useCallback } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import { formatDistance, formatDuration } from '@/lib';
import { SectionSparkline } from '@/components/section/SectionSparkline';
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
  activityId: string;
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
    activityId,
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

    // Find this activity's traversals per direction
    const thisLaps = plotData?.chartData.filter((d) => d.activityId === activityId) ?? [];
    const directions =
      thisLaps.length > 0 ? [...new Set(thisLaps.map((d) => d.direction))] : ['same'];

    const renderCard = (direction: string, cardIndex: number) => {
      const lap = thisLaps.find((d) => d.direction === direction);
      const isReverse = direction === 'reverse';
      const dirData = plotData?.chartData.filter((d) => d.direction === direction) ?? [];
      const sparklineData = dirData.length >= 2 ? dirData : plotData?.chartData;
      const isBest =
        lap && dirData.length > 0 && lap.speed >= Math.max(...dirData.map((d) => d.speed));
      const displayName = isReverse ? `${sectionName} ↩` : sectionName;
      const dirVisitCount = dirData.length || visitCount;

      return (
        <Swipeable
          key={`${sectionId}-${direction}`}
          ref={(ref) => {
            if (ref) {
              swipeableRefs.current.set(`${sectionId}-${direction}`, ref);
            } else {
              swipeableRefs.current.delete(`${sectionId}-${direction}`);
            }
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
            <View style={styles.header}>
              <View style={[styles.numberBadge, { borderColor: style.color }]}>
                <Text style={styles.numberBadgeText}>{index + 1}</Text>
              </View>
              <View style={styles.headerInfo}>
                <Text style={[styles.name, isDark && styles.textLight]} numberOfLines={1}>
                  {displayName}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={[styles.meta, isDark && styles.textMuted]}>
                    {formatDistance(distance, isMetric)} · {dirVisitCount} {t('routes.visits')}
                  </Text>
                  {lap && (
                    <>
                      <Text style={[styles.meta, isDark && styles.textMuted]}> · </Text>
                      <Text style={[styles.timeValue, isDark && styles.textLight]}>
                        {formatDuration(lap.sectionTime ?? 0)}
                      </Text>
                      {isBest && (
                        <MaterialCommunityIcons
                          name="trophy"
                          size={11}
                          color={colors.chartGold}
                          style={{ marginLeft: 2 }}
                        />
                      )}
                    </>
                  )}
                </View>
              </View>
              {sparklineData && sparklineData.length >= 2 && (
                <SectionSparkline
                  data={sparklineData}
                  width={80}
                  height={28}
                  isDark={isDark}
                  highlightActivityId={activityId}
                />
              )}
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={isDark ? '#555' : '#CCC'}
              />
            </View>
          </Pressable>
        </Swipeable>
      );
    };

    return (
      <View testID={`section-inline-plot-${index}`}>
        {directions.map((dir, i) => renderCard(dir, i))}
      </View>
    );
  },
  (prev, next) => {
    return (
      prev.isHighlighted === next.isHighlighted &&
      prev.plotData === next.plotData &&
      prev.isDark === next.isDark &&
      prev.sectionName === next.sectionName &&
      prev.activityId === next.activityId
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
  name: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
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
  timeValue: {
    fontSize: typography.label.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  dirLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginLeft: 4,
  },
});
