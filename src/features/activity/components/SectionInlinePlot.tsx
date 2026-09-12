import React, { memo, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Platform,
  Text as RNText,
  type LayoutChangeEvent,
} from 'react-native';
import { Text } from 'react-native-paper';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  brand,
  colors,
  colorWithOpacity,
  darkColors,
  sectionPalette,
  sectionPaletteIndex,
  spacing,
  typography,
  layout,
} from '@/theme';
import { isPaceSport, isSwimmingActivity } from '@/features/activity/lib/activityUtils';
import { formatDistance, formatDuration, formatPace, formatSwimPace } from '@/shared/format/format';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import { SectionSparkline } from '@/features/routes/components/section/SectionSparkline';
import type { SectionEncounter } from 'veloqrs';
import type { SectionEncounterGroup } from '@/features/activity/lib/groupSectionEncounters';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';

interface SectionInlinePlotProps {
  group: SectionEncounterGroup;
  activityId: string;
  sportType?: string;
  index: number;
  isHighlighted: boolean;
  isDark: boolean;
  isMetric: boolean;
  onPress: (sectionId: string) => void;
  onSwipeableOpen: (sectionId: string) => void;
  /** Report the outer row's measured height so the parent can compute
   *  finger-Y → row-index arithmetically instead of querying per-row layouts. */
  onRowHeight?: (index: number, height: number) => void;
  /** Expose the first row's outer View ref to the parent. Only row 0 needs
   *  to be measured - subsequent rows' positions are pure arithmetic. */
  firstRowRef?: (ref: View | null) => void;
  /**
   * The swipe actions for this row. It takes the group rather than closing over
   * it, so the list passes one function for every row and the memo above holds
   * through a scrub that only moved the highlight.
   */
  renderRightActions: (
    group: SectionEncounterGroup,
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => React.ReactNode;
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable | null>>;
}

/** Pace for foot and water sports, elapsed time otherwise, as SectionInfoCard. */
function formatLap(
  distanceMeters: number,
  lapTime: number,
  sportType: string | undefined,
  isMetric: boolean
): string {
  const type = sportType as ActivityType;
  if (isSwimmingActivity(type)) return formatSwimPace(distanceMeters / lapTime, isMetric);
  if (isPaceSport(type)) return formatPace(distanceMeters / lapTime, isMetric);
  return formatDuration(lapTime);
}

/**
 * Build sparkline points from one encounter's history.
 *
 * Show a window of up to 5 points centred on the current activity (2 before +
 * current + 2 after), shifted to stay inside the history near either end. If
 * the current activity isn't in the history, fall back to the last 5.
 */
function buildSparklineData(
  encounter: SectionEncounter,
  activityId: string
): (PerformanceDataPoint & { x: number })[] | undefined {
  const total = encounter.historyTimes.length;
  if (total < 2) return undefined;

  const WINDOW_SIZE = 5;
  let startIdx = 0;
  let endIdx = total;

  if (total > WINDOW_SIZE) {
    const currentIdx = encounter.historyActivityIds.indexOf(activityId);
    if (currentIdx === -1) {
      startIdx = total - WINDOW_SIZE;
      endIdx = total;
    } else {
      const half = Math.floor(WINDOW_SIZE / 2);
      startIdx = currentIdx - half;
      endIdx = currentIdx + half + 1;
      if (startIdx < 0) {
        endIdx += -startIdx;
        startIdx = 0;
      }
      if (endIdx > total) {
        startIdx -= endIdx - total;
        endIdx = total;
      }
      if (startIdx < 0) startIdx = 0;
    }
  }

  const out: (PerformanceDataPoint & { x: number })[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    const time = encounter.historyTimes[i];
    out.push({
      x: i - startIdx,
      id: encounter.historyActivityIds[i] || '',
      activityId: encounter.historyActivityIds[i] || '',
      speed: time > 0 ? encounter.distanceMeters / time : 0,
      date: new Date(),
      activityName: '',
      direction: encounter.direction as 'same' | 'reverse',
      sectionTime: time,
    });
  }
  return out;
}

export const SectionInlinePlot = memo(
  function SectionInlinePlot({
    group,
    activityId,
    sportType,
    index,
    isHighlighted,
    isDark,
    isMetric,
    onPress,
    onSwipeableOpen,
    onRowHeight,
    firstRowRef,
    renderRightActions,
    swipeableRefs,
  }: SectionInlinePlotProps) {
    const { t } = useTranslation();

    const handlePress = useCallback(() => {
      onPress?.(group.sectionId);
    }, [onPress, group.sectionId]);

    const swipeActions = useCallback(
      (
        progress: Animated.AnimatedInterpolation<number>,
        dragX: Animated.AnimatedInterpolation<number>
      ) => renderRightActions(group, progress, dragX),
      [renderRightActions, group]
    );

    // Colour the card's index number using the same palette + hash as the map's
    // section portions, so card N matches the colour of its section on the map.
    const numberColor = sectionPalette[sectionPaletteIndex(group.sectionId)];

    const sparklines = useMemo(
      () => group.encounters.map((encounter) => buildSparklineData(encounter, activityId)),
      [group.encounters, activityId]
    );

    const handleLayout = useCallback(
      (e: LayoutChangeEvent) => {
        onRowHeight?.(index, e.nativeEvent.layout.height);
      },
      [onRowHeight, index]
    );

    // Only row 0's ref is forwarded to the parent - it's the anchor point the
    // scrub hit-test measures at gesture start. Other rows don't need refs.
    const ownRef = useRef<View | null>(null);
    const handleRef = useCallback(
      (r: View | null) => {
        ownRef.current = r;
        if (index === 0) firstRowRef?.(r);
      },
      [firstRowRef, index]
    );

    return (
      <View ref={handleRef} testID={`section-inline-plot-${index}`} onLayout={handleLayout}>
        <Swipeable
          ref={(ref) => {
            if (ref) {
              swipeableRefs.current.set(group.sectionId, ref);
            } else {
              swipeableRefs.current.delete(group.sectionId);
            }
          }}
          renderRightActions={swipeActions}
          onSwipeableOpen={() => onSwipeableOpen(group.sectionId)}
          overshootRight={false}
          friction={2}
        >
          <Pressable
            onPress={handlePress}
            style={({ pressed }) => [
              styles.card,
              isDark && styles.cardDark,
              isHighlighted && styles.cardHighlighted,
              pressed && Platform.OS === 'ios' && { opacity: 0.7 },
            ]}
          >
            <View style={styles.header}>
              <Text style={[styles.numberLabel, { color: numberColor }]}>{index + 1}</Text>
              <Text style={[styles.name, isDark && styles.textLight]} numberOfLines={1}>
                {group.sectionName}
              </Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={isDark ? darkColors.iconFaint : colors.iconFaint}
              />
            </View>
            {group.encounters.map((encounter, dirIndex) => {
              const isReverse = encounter.direction === 'reverse';
              // A card crossed once forward is the common case and needs no
              // marker. Anything else is labelled so the row says which way.
              const showDirection = group.hasBothDirections || isReverse;
              // The Maestro flows key on the card, so the first row keeps the
              // bare testID and only the extra directions carry a suffix.
              const suffix = dirIndex === 0 ? `${index}` : `${index}-${dirIndex}`;
              const sparklineData = sparklines[dirIndex];
              return (
                <View
                  key={`${encounter.direction}-${dirIndex}`}
                  style={[
                    styles.directionRow,
                    dirIndex > 0 && styles.directionRowDivided,
                    dirIndex > 0 && isDark && styles.directionRowDividedDark,
                  ]}
                >
                  {showDirection && (
                    <Text
                      accessibilityLabel={t(isReverse ? 'sections.reverse' : 'sections.forward')}
                      style={[styles.directionBadge, isDark && styles.textMuted]}
                    >
                      {isReverse ? '↩' : '→'}
                    </Text>
                  )}
                  <View style={styles.directionInfo}>
                    <View style={styles.metaRow}>
                      <RNText style={[styles.meta, isDark && styles.textMuted]}>
                        {formatDistance(encounter.distanceMeters, isMetric)} ·{' '}
                        {encounter.visitCount} {t('routes.visits')}
                        {encounter.lapTime > 0 && (
                          <>
                            <RNText style={[styles.meta, isDark && styles.textMuted]}> · </RNText>
                            <RNText style={[styles.timeValue, isDark && styles.textLight]}>
                              {formatLap(
                                encounter.distanceMeters,
                                encounter.lapTime,
                                sportType,
                                isMetric
                              )}
                            </RNText>
                          </>
                        )}
                      </RNText>
                      {encounter.isPr && (
                        <MaterialCommunityIcons
                          testID={`section-inline-trophy-${suffix}`}
                          name="trophy"
                          size={11}
                          color={brand.gold}
                          style={{ marginLeft: spacing.xxs }}
                        />
                      )}
                    </View>
                  </View>
                  {sparklineData && (
                    <View testID={`section-inline-sparkline-${suffix}`}>
                      <SectionSparkline
                        data={sparklineData}
                        width={80}
                        height={28}
                        isDark={isDark}
                        highlightActivityId={activityId}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </Pressable>
        </Swipeable>
      </View>
    );
  },
  (prev, next) =>
    rowIsUnchanged(
      {
        record: prev.group,
        extras: [
          prev.isHighlighted,
          prev.index,
          prev.isDark,
          prev.isMetric,
          prev.activityId,
          prev.sportType,
          prev.renderRightActions,
        ],
      },
      {
        record: next.group,
        extras: [
          next.isHighlighted,
          next.index,
          next.isDark,
          next.isMetric,
          next.activityId,
          next.sportType,
          next.renderRightActions,
        ],
      }
    )
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
    backgroundColor: colorWithOpacity(colors.chartCyan, 0.15),
    borderColor: colors.chartCyan,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  numberLabel: {
    width: 26,
    textAlign: 'center',
    fontSize: typography.metricValue.fontSize,
    fontWeight: '800',
    color: colors.textSecondary,
    marginRight: spacing.sm,
  },
  name: {
    flex: 1,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    paddingLeft: 26 + spacing.sm * 2,
  },
  directionRowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.xs,
  },
  directionRowDividedDark: {
    borderTopColor: darkColors.border,
  },
  directionBadge: {
    width: 16,
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  directionInfo: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
