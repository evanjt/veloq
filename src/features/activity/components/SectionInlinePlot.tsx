import React, { memo, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, Pressable, Text as RNText, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  brand,
  colors,
  colorWithOpacity,
  darkColors,
  sectionNumberInk,
  sectionPalette,
  sectionPaletteIndex,
  spacing,
  typography,
  layout,
} from '@/theme';
import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import { formatDistance, formatDuration, formatSportSpeed } from '@/shared/format/format';
import {
  accessibleActions,
  composeAccessibilityLabel,
  pressable,
  pressRipple,
  type AccessibleAction,
} from '@/shared/ui';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import { SectionSparkline } from '@/features/routes';
import type { SectionEncounter } from 'veloqrs';
import type { SectionEncounterGroup } from '@/features/activity/lib/groupSectionEncounters';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';

interface SectionInlinePlotProps {
  group: SectionEncounterGroup;
  activityId: string;
  sportType?: string | undefined;
  index: number;
  isHighlighted: boolean;
  isDark: boolean;
  isMetric: boolean;
  onPress: (sectionId: string) => void;
  onSwipeableOpen: (sectionId: string) => void;
  /** Report the outer row's measured height so the parent can compute
   *  finger-Y → row-index arithmetically instead of querying per-row layouts. */
  onRowHeight?: ((index: number, height: number) => void) | undefined;
  /** Expose the first row's outer View ref to the parent. Only row 0 needs
   *  to be measured - subsequent rows' positions are pure arithmetic. */
  firstRowRef?: ((ref: View | null) => void) | undefined;
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
  /**
   * What the swipe actions do, offered to a screen reader on the card, which
   * takes the swipe for itself. One function for every row, as above.
   */
  actionsFor: (group: SectionEncounterGroup) => readonly AccessibleAction[];
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable | null>>;
}

/** Pace for foot and water sports, elapsed time otherwise, as SectionInfoCard. */
function formatLap(
  lapPace: number,
  lapTime: number,
  sportType: string | undefined,
  isMetric: boolean
): string {
  const type = sportType as ActivityType;
  if (isSwimmingActivity(type) || isPaceSport(type)) {
    return formatSportSpeed(lapPace, type, isMetric);
  }
  return formatDuration(lapTime);
}

/** The place word a medal marks, for ranks two and three of a complete pass. */
function placeKey(
  encounter: SectionEncounter
): 'sections.placeSecond' | 'sections.placeThird' | null {
  if (!encounter.isComplete) return null;
  if (encounter.rank === 2) return 'sections.placeSecond';
  if (encounter.rank === 3) return 'sections.placeThird';
  return null;
}

/**
 * The name a screen reader speaks for a section card, which is one element.
 *
 * The section name, then each direction in the order the card draws it: the
 * direction word where the card marks one, the distance, the visits, the lap,
 * the partial word, the record and the place. Each direction is composed on
 * its own so a distance both directions share is spoken for each.
 */
export function sectionCardAccessibilityLabel(
  group: SectionEncounterGroup,
  sportType: string | undefined,
  isMetric: boolean,
  t: TFunction
): string {
  const directions = group.encounters.map((encounter) => {
    const isReverse = encounter.direction === 'reverse';
    const isPartialDirection = encounter.direction === 'partial';
    const showDirection = !isPartialDirection && (group.hasBothDirections || isReverse);
    const place = placeKey(encounter);
    return composeAccessibilityLabel(
      isPartialDirection
        ? t('sections.partial')
        : showDirection && t(isReverse ? 'sections.reverse' : 'sections.forward'),
      formatDistance(encounter.distanceMeters, isMetric),
      encounter.historyTimes.length > 0 &&
        t('sections.visitsCount', { count: encounter.visitCount }),
      encounter.lapTime > 0 && formatLap(encounter.lapPace, encounter.lapTime, sportType, isMetric),
      !encounter.isComplete && !isPartialDirection && t('sections.partial'),
      encounter.isComplete && encounter.isPr && t('a11y.personalRecord'),
      place && t(place)
    );
  });
  return composeAccessibilityLabel(group.sectionName, ...directions);
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
    actionsFor,
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

    const cardActions = useMemo(() => accessibleActions(actionsFor(group)), [actionsFor, group]);

    // The card's index number sits on a disc of the colour the map draws its
    // section in, so card N matches its section on the map. The palette is
    // drawn for map lines and most of it is under 3:1 on white, so the hue is
    // the disc and the number takes the ink measured against that slot.
    const numberSlot = sectionPaletteIndex(group.sectionId);

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
            accessibilityRole="button"
            accessibilityLabel={sectionCardAccessibilityLabel(group, sportType, isMetric, t)}
            {...cardActions}
            onPress={handlePress}
            style={pressable([
              styles.card,
              isDark && styles.cardDark,
              isHighlighted && styles.cardHighlighted,
            ])}
            android_ripple={pressRipple}
          >
            <View style={styles.header}>
              <View style={[styles.numberDisc, { backgroundColor: sectionPalette[numberSlot] }]}>
                <Text style={[styles.numberLabel, { color: sectionNumberInk(numberSlot) }]}>
                  {index + 1}
                </Text>
              </View>
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
              const isPartialDirection = encounter.direction === 'partial';
              // A card crossed once forward is the common case and needs no
              // marker. Anything else is labelled so the row says which way.
              const showDirection = !isPartialDirection && (group.hasBothDirections || isReverse);
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
                  {isPartialDirection ? (
                    <Text
                      testID={`section-inline-partial-${suffix}`}
                      accessibilityLabel={t('sections.partial')}
                      style={[styles.partialBadge, isDark && styles.textSecondary]}
                    >
                      {t('sections.partial')}
                    </Text>
                  ) : (
                    showDirection && (
                      <Text
                        accessibilityLabel={t(isReverse ? 'sections.reverse' : 'sections.forward')}
                        style={[styles.directionBadge, isDark && styles.textSecondary]}
                      >
                        {isReverse ? '↩' : '→'}
                      </Text>
                    )
                  )}
                  <View style={styles.directionInfo}>
                    <View style={styles.metaRow}>
                      <RNText style={[styles.meta, isDark && styles.textSecondary]}>
                        {formatDistance(encounter.distanceMeters, isMetric)}
                        {encounter.historyTimes.length > 0 &&
                          ` · ${t('sections.visitsCount', { count: encounter.visitCount })}`}
                        {encounter.lapTime > 0 && (
                          <>
                            <RNText style={[styles.meta, isDark && styles.textSecondary]}>
                              {' '}
                              ·{' '}
                            </RNText>
                            <RNText style={[styles.timeValue, isDark && styles.textLight]}>
                              {formatLap(encounter.lapPace, encounter.lapTime, sportType, isMetric)}
                            </RNText>
                          </>
                        )}
                      </RNText>
                      {!encounter.isComplete && !isPartialDirection && (
                        <Text
                          testID={`section-inline-partial-${suffix}`}
                          accessibilityLabel={t('sections.partial')}
                          style={[styles.partialMeta, isDark && styles.textSecondary]}
                        >
                          {t('sections.partial')}
                        </Text>
                      )}
                      {encounter.isComplete && encounter.isPr && (
                        <View
                          testID={`section-inline-trophy-${suffix}`}
                          accessible
                          accessibilityRole="image"
                          accessibilityLabel={t('a11y.personalRecord')}
                          style={{ marginLeft: spacing.xxs }}
                        >
                          <MaterialCommunityIcons name="trophy" size={11} color={brand.gold} />
                        </View>
                      )}
                      {encounter.isComplete && (encounter.rank === 2 || encounter.rank === 3) && (
                        <View
                          testID={`section-inline-place-${suffix}`}
                          accessible
                          accessibilityLabel={t(
                            encounter.rank === 2 ? 'sections.placeSecond' : 'sections.placeThird'
                          )}
                          style={{ marginLeft: spacing.xxs }}
                        >
                          <MaterialCommunityIcons
                            name="medal"
                            size={11}
                            color={
                              encounter.rank === 2
                                ? isDark
                                  ? darkColors.chartSilverMark
                                  : colors.chartSilverMark
                                : isDark
                                  ? darkColors.chartBronzeMark
                                  : colors.chartBronzeMark
                            }
                          />
                        </View>
                      )}
                    </View>
                  </View>
                  {encounter.historyTimes.length > 0 && sparklineData && (
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
          prev.actionsFor,
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
          next.actionsFor,
        ],
      }
    )
);

const DIRECTION_LABEL_WIDTH = 26;
/** The index number's disc, as wide as the column the direction rows indent past. */
const NUMBER_DISC = DIRECTION_LABEL_WIDTH;

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
  // The border is the only thing saying this card is the one being viewed, so
  // it takes the mark tone rather than the series one.
  cardHighlighted: {
    backgroundColor: colorWithOpacity(colors.markCyan, 0.15),
    borderColor: colors.markCyan,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  numberDisc: {
    width: NUMBER_DISC,
    height: NUMBER_DISC,
    borderRadius: layout.borderRadiusFull,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  numberLabel: {
    textAlign: 'center',
    fontSize: typography.metricValue.fontSize,
    fontWeight: '800',
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
    paddingLeft: DIRECTION_LABEL_WIDTH + spacing.md,
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
  partialBadge: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  partialMeta: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginLeft: spacing.xxs,
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
  textSecondary: {
    color: darkColors.textSecondary,
  },
  timeValue: {
    fontSize: typography.label.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
