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

    return (
      <View testID={`section-inline-plot-${index}`}>
        <Swipeable
          ref={(ref) => {
            if (ref) {
              swipeableRefs.current.set(sectionId, ref);
            } else {
              swipeableRefs.current.delete(sectionId);
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
            {(() => {
              // Find all traversals of this activity on this section
              const thisLaps = plotData?.chartData.filter((d) => d.activityId === activityId) ?? [];
              const fwdLap = thisLaps.find((d) => d.direction === 'same');
              const revLap = thisLaps.find((d) => d.direction === 'reverse');
              const hasReverse = fwdLap && revLap;

              const renderDirStats = (
                lap: (typeof thisLaps)[0] | undefined,
                label: string | null
              ) => {
                if (!lap) return null;
                const dirData =
                  plotData?.chartData.filter((d) => d.direction === lap.direction) ?? [];
                const isBest =
                  dirData.length > 0 && lap.speed >= Math.max(...dirData.map((d) => d.speed));
                const avgTime =
                  dirData.length > 0
                    ? dirData.reduce((s, d) => s + (d.sectionTime ?? 0), 0) / dirData.length
                    : null;
                const trendPct =
                  lap.sectionTime && avgTime && avgTime > 0
                    ? ((lap.sectionTime - avgTime) / avgTime) * 100
                    : null;

                return (
                  <View style={styles.metaRow}>
                    {label && (
                      <Text style={[styles.meta, isDark && styles.textMuted]}>{label} · </Text>
                    )}
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
                    {trendPct !== null && Math.abs(trendPct) >= 1 && (
                      <MaterialCommunityIcons
                        name={trendPct < 0 ? 'trending-down' : 'trending-up'}
                        size={11}
                        color={trendPct < 0 ? '#4CAF50' : '#F44336'}
                        style={{ marginLeft: 3 }}
                      />
                    )}
                  </View>
                );
              };

              return (
                <View style={styles.header}>
                  <View style={[styles.numberBadge, { borderColor: style.color }]}>
                    <Text style={styles.numberBadgeText}>{index + 1}</Text>
                  </View>
                  <View style={styles.headerInfo}>
                    <Text style={[styles.name, isDark && styles.textLight]} numberOfLines={1}>
                      {sectionName}
                    </Text>
                    <View style={styles.metaRow}>
                      <Text style={[styles.meta, isDark && styles.textMuted]}>
                        {formatDistance(distance, isMetric)} · {visitCount} {t('routes.visits')}
                      </Text>
                    </View>
                    {hasReverse ? (
                      <>
                        {renderDirStats(fwdLap, t('sections.forward'))}
                        {renderDirStats(revLap, t('sections.reverse'))}
                      </>
                    ) : (
                      renderDirStats(thisLaps[0], null)
                    )}
                  </View>
                  {plotData && plotData.chartData.length >= 2 && (
                    <SectionSparkline
                      data={plotData.chartData}
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
              );
            })()}
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
});
