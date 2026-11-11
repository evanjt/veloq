import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewInstance,
} from 'react-native';
import { Text } from 'react-native-paper';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { SharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  brand,
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  sectionNumberInk,
  sectionPalette,
  sectionPaletteIndex,
  spacing,
  typography,
  stroke,
  opacity,
} from '@/theme';
import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import {
  formatDistance,
  formatDuration,
  formatShortDate,
  formatSportSpeed,
} from '@/shared/format/format';
import {
  type AccessibleAction,
  accessibleActions,
  composeAccessibilityLabel,
  PressTarget,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { RankRing } from '@/shared/charts/RankRing';
import { seriesSummary, type SparklinePoint } from '@/shared/charts';
import { wallClockSecondsToLocalDate } from '@/shared/time/startDate';
import type { ActivityType } from '@/types';
import { SectionSparkline } from '@/features/routes';
import type { SectionEncounter } from 'veloqrs';
import type { SectionEncounterGroup } from '@/features/activity/lib/groupSectionEncounters';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';
import { NameText } from '@/shared/ui/NameText';
import { FitText } from '@/shared/ui/FitText';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { labelWords } from '@/shared/ui/buttonRowLayout';
import {
  DIRECTION_BADGE_WIDTH,
  DIRECTION_LABEL_WIDTH,
  DIRECTION_ROW_GAP,
  MARKER_SLOT_WIDTH,
  PACE_TYPE,
  SECTION_PLOT_HEIGHT,
  SECTION_PLOT_WIDTH,
  sectionMetaStacks,
  sectionRowShowsRange,
} from '@/features/activity/lib/sectionInlineRowLayout';

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
  firstRowRef?: ((ref: ViewInstance | null) => void) | undefined;
  /**
   * The swipe actions for this row. It takes the group rather than closing over
   * it, so the list passes one function for every row and the memo above holds
   * through a scrub that only moved the highlight.
   */
  renderRightActions: (
    group: SectionEncounterGroup,
    progress: SharedValue<number>,
    drag: SharedValue<number>
  ) => React.ReactNode;
  /**
   * What the swipe actions do, offered to a screen reader on the card, which
   * takes the swipe for itself. One function for every row, as above.
   */
  actionsFor: (group: SectionEncounterGroup) => readonly AccessibleAction[];
  swipeableRefs: React.MutableRefObject<Map<string, SwipeableMethods | null>>;
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
 * the partial word, the record, the place and the sparkline's summary, which
 * speaks its range. Each direction is composed on its own so a distance both
 * directions share is spoken for each.
 */
export function sectionCardAccessibilityLabel(
  group: SectionEncounterGroup,
  sportType: string | undefined,
  isMetric: boolean,
  t: TFunction,
  sparklines: readonly (SectionSparklineData | undefined)[] = []
): string {
  const directions = group.encounters.map((encounter, i) => {
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
        t('sections.traversalsCount', { count: encounter.visitCount }),
      encounter.lapTime > 0 && formatLap(encounter.lapPace, encounter.lapTime, sportType, isMetric),
      !encounter.isComplete && !isPartialDirection && t('sections.partial'),
      encounter.isComplete && encounter.isPr && t('a11y.personalRecord'),
      place && t(place),
      sparklines[i]?.summary
    );
  });
  return composeAccessibilityLabel(group.sectionName, ...directions);
}

/** One direction's sparkline: its points, this activity's place among them, and what it speaks. */
export interface SectionSparklineData {
  points: SparklinePoint[];
  highlightIndex: number | undefined;
  name: string;
  format: (metresPerSecond: number) => string;
  summary: string;
}

/**
 * The sparkline for one encounter's history: speed per attempt at its date.
 *
 * Show a window of up to 5 points centred on the current activity (2 before +
 * current + 2 after), shifted to stay inside the history near either end. If
 * the current activity isn't in the history, fall back to the last 5.
 */
export function sectionSparklineData(
  encounter: SectionEncounter,
  activityId: string,
  sportType: string | undefined,
  isMetric: boolean,
  t: TFunction
): SectionSparklineData | undefined {
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

  const type = sportType as ActivityType;
  const pace = isSwimmingActivity(type) || isPaceSport(type);
  const format = (speed: number) => formatSportSpeed(speed, type, isMetric);
  const name = t(pace ? 'chartTypes.pace' : 'chartTypes.speed');
  const points: SparklinePoint[] = [];
  let highlightIndex: number | undefined;
  for (let i = startIdx; i < endIdx; i++) {
    const time = encounter.historyTimes[i] ?? 0;
    const id = encounter.historyActivityIds[i] ?? '';
    const date = encounter.historyDates[i];
    if (id === activityId) highlightIndex = points.length;
    points.push({
      value: time > 0 ? encounter.distanceMeters / time : 0,
      label:
        date !== undefined ? formatShortDate(wallClockSecondsToLocalDate(date)) : String(i + 1),
      key: `${id}-${i}`,
      ...(date !== undefined ? { date } : {}),
    });
  }
  const summary = seriesSummary({ name, points, format }, t);
  return { points, highlightIndex, name, format, summary };
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
      (progress: SharedValue<number>, drag: SharedValue<number>) =>
        renderRightActions(group, progress, drag),
      [renderRightActions, group]
    );

    const cardActions = useMemo(() => accessibleActions(actionsFor(group)), [actionsFor, group]);

    // The card's index number sits on a disc of the colour the map draws its
    // section in, so card N matches its section on the map. The palette is
    // drawn for map lines and most of it is under 3:1 on white, so the hue is
    // the disc and the number takes the ink measured against that slot.
    const numberSlot = sectionPaletteIndex(group.sectionId);

    const sparklines = useMemo(
      () =>
        group.encounters.map((encounter) =>
          sectionSparklineData(encounter, activityId, sportType, isMetric, t)
        ),
      [group.encounters, activityId, sportType, isMetric, t]
    );

    const handleLayout = useCallback(
      (e: LayoutChangeEvent) => {
        onRowHeight?.(index, e.nativeEvent.layout.height);
      },
      [onRowHeight, index]
    );

    // Every direction row is as wide as the first, so one measurement decides
    // for the card whether the range labels still fit beside the pace.
    const [rowWidth, setRowWidth] = useState<number | undefined>(undefined);
    const handleRowLayout = useCallback((e: LayoutChangeEvent) => {
      setRowWidth(e.nativeEvent.layout.width);
    }, []);
    const { fontScale } = useWindowDimensions();
    const showRange = sectionRowShowsRange(rowWidth, fontScale);

    // The drawn width of a leading badge and of each word on a direction's line, keyed by what
    // it measures. The words are drawn at the text size the line uses, so they decide the wrap.
    const [measures, setMeasures] = useState<Readonly<Record<string, number>>>({});
    const measure = useCallback((key: string, width: number) => {
      setMeasures((prev) => (prev[key] === width ? prev : { ...prev, [key]: width }));
    }, []);

    // Only row 0's ref is forwarded to the parent - it's the anchor point the
    // scrub hit-test measures at gesture start. Other rows don't need refs.
    const ownRef = useRef<ViewInstance | null>(null);
    const handleRef = useCallback(
      (r: ViewInstance | null) => {
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
          <PressTarget
            accessibilityRole="button"
            accessibilityLabel={sectionCardAccessibilityLabel(
              group,
              sportType,
              isMetric,
              t,
              sparklines
            )}
            {...cardActions}
            onPress={handlePress}
            style={[
              styles.card,
              isDark && styles.cardDark,
              isHighlighted && styles.cardHighlighted,
            ]}
          >
            <View style={styles.header}>
              <View style={[styles.numberDisc, { backgroundColor: sectionPalette[numberSlot] }]}>
                <Text style={[styles.numberLabel, { color: sectionNumberInk(numberSlot) }]}>
                  {index + 1}
                </Text>
              </View>
              <NameText style={[styles.name, isDark && styles.textLight]}>
                {group.sectionName}
              </NameText>
              <Icon
                name="chevron-right"
                size={iconSize.md}
                color={isDark ? darkColors.iconMuted : colors.iconMuted}
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
              const metaLine =
                formatDistance(encounter.distanceMeters, isMetric) +
                (encounter.historyTimes.length > 0
                  ? ` · ${t('sections.traversalsCount', { count: encounter.visitCount })}`
                  : '');
              const metaWords = labelWords(metaLine);
              const widestWord = Math.max(
                0,
                ...metaWords.map((_, j) => measures[`word:${dirIndex}:${j}`] ?? 0)
              );
              const hasLead = isPartialDirection || showDirection;
              const metaStacked = sectionMetaStacks({
                rowWidth,
                showRange,
                leadWidth: hasLead ? (measures[`lead:${dirIndex}`] ?? 0) : 0,
                widestWord,
              });
              const meta = (
                <Text
                  testID={`section-inline-meta-${suffix}`}
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[
                    styles.meta,
                    isDark && styles.textSecondary,
                    metaStacked && styles.metaOwnLine,
                  ]}
                >
                  {metaLine}
                </Text>
              );
              return (
                <View
                  key={`${encounter.direction}-${dirIndex}`}
                  testID={`section-inline-row-${suffix}`}
                  onLayout={dirIndex === 0 ? handleRowLayout : undefined}
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
                      onLayout={(e) => measure(`lead:${dirIndex}`, e.nativeEvent.layout.width)}
                      style={[styles.partialBadge, isDark && styles.textSecondary]}
                    >
                      {t('sections.partial')}
                    </Text>
                  ) : (
                    showDirection && (
                      <Text
                        accessibilityLabel={t(isReverse ? 'sections.reverse' : 'sections.forward')}
                        onLayout={(e) => measure(`lead:${dirIndex}`, e.nativeEvent.layout.width)}
                        style={[styles.directionBadge, isDark && styles.textSecondary]}
                      >
                        {isReverse ? '↩' : '→'}
                      </Text>
                    )
                  )}
                  <View testID={`section-inline-text-${suffix}`} style={styles.textColumn}>
                    {encounter.lapTime > 0 && (
                      <FitText
                        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                        style={[styles.pace, isDark && styles.textLight]}
                      >
                        {formatLap(encounter.lapPace, encounter.lapTime, sportType, isMetric)}
                      </FitText>
                    )}
                    {!metaStacked && meta}
                  </View>
                  <View testID={`section-inline-markers-${suffix}`} style={styles.markerSlot}>
                    {!encounter.isComplete && !isPartialDirection && (
                      <Text
                        testID={`section-inline-partial-${suffix}`}
                        accessibilityLabel={t('sections.partial')}
                        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                        style={[styles.partialMeta, isDark && styles.textSecondary]}
                      >
                        {t('sections.partial')}
                      </Text>
                    )}
                    {encounter.isComplete && encounter.isPr ? (
                      <View
                        testID={`section-inline-trophy-${suffix}`}
                        accessible
                        accessibilityRole="image"
                        accessibilityLabel={t('a11y.personalRecord')}
                      >
                        <Icon name="trophy" size={iconSize.xs} color={brand.gold} />
                      </View>
                    ) : null}
                    {encounter.isComplete && (encounter.rank === 2 || encounter.rank === 3) ? (
                      <RankRing
                        testID={`section-inline-place-${suffix}`}
                        rank={encounter.rank}
                        isDark={isDark}
                        accessibilityLabel={t(
                          encounter.rank === 2 ? 'sections.placeSecond' : 'sections.placeThird'
                        )}
                      />
                    ) : null}
                  </View>
                  {encounter.historyTimes.length > 0 && sparklineData ? (
                    <View testID={`section-inline-sparkline-${suffix}`} style={styles.plotColumn}>
                      <SectionSparkline
                        points={sparklineData.points}
                        name={sparklineData.name}
                        format={sparklineData.format}
                        summary={sparklineData.summary}
                        highlightIndex={sparklineData.highlightIndex}
                        width={SECTION_PLOT_WIDTH}
                        height={SECTION_PLOT_HEIGHT}
                        showRange={showRange}
                      />
                    </View>
                  ) : null}
                  {metaStacked ? meta : null}
                  <View
                    style={styles.measureProbe}
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    {metaWords.map((word, j) => (
                      <Text
                        key={j}
                        testID={`section-inline-measure-${suffix}-${j}`}
                        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                        style={styles.meta}
                        onLayout={(e) =>
                          measure(`word:${dirIndex}:${j}`, e.nativeEvent.layout.width)
                        }
                      >
                        {word}
                      </Text>
                    ))}
                  </View>
                </View>
              );
            })}
          </PressTarget>
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

/** The index number's disc, as wide as the column the direction rows indent past. */
const NUMBER_DISC = DIRECTION_LABEL_WIDTH;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.md,
    overflow: 'hidden',
    borderWidth: stroke.two,
    borderColor: 'transparent',
  },
  cardDark: {
    backgroundColor: darkColors.surfaceRaised,
  },
  // The border is the only thing saying this card is the one being viewed, so
  // it takes the mark tone rather than the series one.
  cardHighlighted: {
    backgroundColor: colorWithOpacity(colors.markCyan, opacity.tint2),
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
    ...typography.metricValue,
    textAlign: 'center',
  },
  name: {
    ...typography.bodyBold,
    flex: 1,
    color: colors.textPrimary,
  },
  // The wrap exists for the distance and traversals line, which drops to a line of its own when
  // the text column cannot hold its widest word. The text column's basis is zero, so the pace,
  // the markers and the plot still share one line.
  directionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: DIRECTION_ROW_GAP,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    paddingLeft: DIRECTION_LABEL_WIDTH + spacing.md,
  },
  directionRowDivided: {
    borderTopWidth: stroke.hairline,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  directionRowDividedDark: {
    borderTopColor: darkColors.border,
  },
  directionBadge: {
    width: DIRECTION_BADGE_WIDTH,
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  partialBadge: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  partialMeta: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  // The text column is the one piece that narrows: minWidth 0 lets it shrink
  // below its text, so the pace shrinks to fit and the meta line wraps rather
  // than pushing the markers onto the plot.
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  markerSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexShrink: 0,
    minWidth: MARKER_SLOT_WIDTH,
    gap: spacing.xxs,
  },
  plotColumn: {
    flexShrink: 0,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  pace: {
    ...PACE_TYPE,
    color: colors.textPrimary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metaOwnLine: {
    flexBasis: '100%',
  },
  // Out of the flow and invisible, each word on a line of its own so it reports its drawn width.
  measureProbe: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
    alignItems: 'flex-start',
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
