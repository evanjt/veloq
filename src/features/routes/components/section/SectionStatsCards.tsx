/**
 * Calendar performance history for a section.
 * Shows a collapsible year > month breakdown of traversal times and PRs.
 */

import { useMetricSystem } from '@/shared/app';
import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@/shared/format/format';
import { formatAttemptFigure, type AttemptBasis } from '@/features/routes/lib/attemptBasis';
import { colors, darkColors, iconSize, slopToMinTapTarget, spacing, typography } from '@/theme';
import { Card, DisclosureChevron, pressable, pressRipple } from '@/shared/ui';
import { tapTo } from '@/shared/app/navigation';
import { DirectionArrow, directionWord } from './DirectionCue';

const REVERSE_COLOR = colors.reverseDirection;

interface CalendarDirectionBest {
  count: number;
  bestTime: number;
  bestPace: number;
  bestActivityId: string;
  bestActivityName: string;
}

interface CalendarMonthSummary {
  month: number;
  /** Laps, both directions. */
  traversalCount: number;
  /** Distinct activities the laps came from. */
  activityCount: number;
  forward?: CalendarDirectionBest;
  reverse?: CalendarDirectionBest;
}

interface CalendarYearSummary {
  year: number;
  /** Laps, both directions. */
  traversalCount: number;
  /** Distinct activities the laps came from. */
  activityCount: number;
  forward?: CalendarDirectionBest;
  reverse?: CalendarDirectionBest;
  months: CalendarMonthSummary[];
}

export interface CalendarSummary {
  years: CalendarYearSummary[];
  forwardPr?: CalendarDirectionBest;
  reversePr?: CalendarDirectionBest;
  sectionDistance: number;
}

export interface SectionStatsCardsProps {
  calendarSummary: CalendarSummary;
  isDark: boolean;
  /** What the year and month bests read as, the basis the chart plots on. */
  basis: AttemptBasis;
  activityColor: string;
  onSetAsReference?: ((activityId: string) => void) | undefined;
  referenceActivityId?: string | undefined;
  /**
   * Every activity's time stream is read, so the overall bests are the
   * record. Until then they draw no record mark. Absent means settled.
   */
  recordsSettled?: boolean | undefined;
}

export function SectionStatsCards({
  calendarSummary,
  isDark,
  basis,
  activityColor,
  onSetAsReference,
  referenceActivityId,
  recordsSettled = true,
}: SectionStatsCardsProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const [expandedYears, setExpandedYears] = useState<Set<number>>(() => {
    if (calendarSummary.years.length > 0) {
      return new Set([calendarSummary.years[0].year]);
    }
    return new Set();
  });

  const toggleYear = useCallback((year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  }, []);

  const monthNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(getIntlLocale(), { month: 'short' });
    return Array.from({ length: 12 }, (_, i) => formatter.format(new Date(2024, i, 1)));
  }, []);

  const formatBest = (entry: CalendarDirectionBest) =>
    formatAttemptFigure(basis, entry.bestTime, entry.bestPace, isMetric);

  if (calendarSummary.years.length < 1) {
    return null;
  }

  const forwardPr = recordsSettled ? calendarSummary.forwardPr : undefined;
  const reversePr = recordsSettled ? calendarSummary.reversePr : undefined;

  return (
    <Card variant="flat" padding="none" testID="section-calendar">
      <View style={styles.calendarSection}>
        {calendarSummary.years.map((yearData) => {
          const isYearExpanded = expandedYears.has(yearData.year);
          const yearFwd = yearData.forward;
          const yearRev = yearData.reverse;
          const formatYearBest = (entry: CalendarDirectionBest | undefined) =>
            entry ? formatBest(entry) : '';
          const isYearFwdPr =
            yearFwd && forwardPr && yearFwd.bestActivityId === forwardPr.bestActivityId;
          const isYearRevPr =
            yearRev && reversePr && yearRev.bestActivityId === reversePr.bestActivityId;

          return (
            <View key={yearData.year}>
              <Pressable
                style={pressable([styles.calendarYearRow, isDark && styles.calendarYearRowDark])}
                android_ripple={pressRipple}
                accessibilityRole="button"
                accessibilityLabel={`${t('stats.year')} ${yearData.year}`}
                accessibilityState={{ expanded: isYearExpanded }}
                onPress={() => toggleYear(yearData.year)}
              >
                <DisclosureChevron
                  expanded={isYearExpanded}
                  size={iconSize.md}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.calendarYearText, isDark && styles.textLight]}>
                  {yearData.year}
                </Text>
                <Text style={[styles.calendarYearSubtitle, isDark && styles.textSecondary]}>
                  {yearFwd && yearRev ? (
                    <>
                      {`${t('sections.traversalsCount', { count: yearData.traversalCount })} · `}
                      <DirectionArrow
                        direction="forward"
                        color={activityColor}
                        size={iconSize.xs}
                      />
                      {` ${directionWord(t, 'forward')} `}
                      <Text testID={`year-best-forward-${yearData.year}`}>
                        {formatYearBest(yearFwd)}
                      </Text>
                      {'  '}
                      <DirectionArrow
                        direction="reverse"
                        color={REVERSE_COLOR}
                        size={iconSize.xs}
                      />
                      {` ${directionWord(t, 'reverse')} `}
                      <Text testID={`year-best-reverse-${yearData.year}`}>
                        {formatYearBest(yearRev)}
                      </Text>
                    </>
                  ) : (
                    t('sections.traversalsSummary', {
                      count: yearData.traversalCount,
                      time: formatYearBest(yearFwd ?? yearRev),
                    })
                  )}
                  {` · ${t('sections.calendarActivities', { count: yearData.activityCount })}`}
                </Text>
                {isYearFwdPr ? (
                  <View style={styles.calendarTrophy}>
                    <MaterialCommunityIcons
                      name="trophy"
                      size={iconSize.sm}
                      color={activityColor}
                    />
                    {yearRev ? (
                      <DirectionArrow
                        direction="forward"
                        color={activityColor}
                        size={iconSize.xs}
                      />
                    ) : null}
                  </View>
                ) : null}
                {isYearRevPr ? (
                  <View style={styles.calendarTrophy}>
                    <MaterialCommunityIcons
                      name="trophy"
                      size={iconSize.sm}
                      color={REVERSE_COLOR}
                    />
                    {yearFwd ? (
                      <DirectionArrow
                        direction="reverse"
                        color={REVERSE_COLOR}
                        size={iconSize.xs}
                      />
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
              {isYearExpanded
                ? yearData.months.map((monthData) => {
                    const fwd = monthData.forward;
                    const rev = monthData.reverse;
                    const isMonthFwdYearBest =
                      fwd && yearFwd && fwd.bestActivityId === yearFwd.bestActivityId;
                    const isMonthRevYearBest =
                      rev && yearRev && rev.bestActivityId === yearRev.bestActivityId;
                    const isMonthFwdOverallPr =
                      fwd && forwardPr && fwd.bestActivityId === forwardPr.bestActivityId;
                    const isMonthRevOverallPr =
                      rev && reversePr && rev.bestActivityId === reversePr.bestActivityId;

                    return (
                      <View
                        key={monthData.month}
                        style={[styles.calendarMonthRow, isDark && styles.calendarMonthRowDark]}
                      >
                        <Text style={[styles.calendarMonthName, isDark && styles.textSecondary]}>
                          {monthNames[monthData.month - 1]}
                        </Text>
                        <Text style={[styles.calendarMonthCount, isDark && styles.textSecondary]}>
                          {monthData.traversalCount}
                        </Text>
                        <View style={styles.calendarMonthEntries}>
                          {fwd ? (
                            <View style={styles.calendarMonthEntryRow}>
                              <Pressable
                                style={pressable(styles.calendarMonthEntry)}
                                android_ripple={pressRipple}
                                accessibilityRole="button"
                                accessibilityLabel={`${directionWord(t, 'forward')}, ${formatBest(fwd)}, ${fwd.bestActivityName}`}
                                onPress={() => tapTo(`/activity/${fwd.bestActivityId}`)}
                              >
                                <DirectionArrow
                                  direction="forward"
                                  color={activityColor}
                                  size={iconSize.xs}
                                />
                                <Text
                                  style={[
                                    styles.calendarMonthTime,
                                    isDark && styles.textLight,
                                    isMonthFwdYearBest && { fontWeight: '700' },
                                  ]}
                                >
                                  {formatBest(fwd)}
                                </Text>
                                {isMonthFwdYearBest || isMonthFwdOverallPr ? (
                                  <MaterialCommunityIcons
                                    name="trophy"
                                    size={iconSize.xs}
                                    color={
                                      isMonthFwdOverallPr
                                        ? isDark
                                          ? darkColors.chartGoldMark
                                          : colors.chartGoldMark
                                        : activityColor
                                    }
                                  />
                                ) : null}
                                {isMonthFwdOverallPr ? (
                                  <Text style={[styles.prTag, isDark && styles.prTagDark]}>
                                    {t('sections.legendPr')}
                                  </Text>
                                ) : null}
                              </Pressable>
                              {onSetAsReference ? (
                                <ReferenceStar
                                  isReference={fwd.bestActivityId === referenceActivityId}
                                  isDark={isDark}
                                  label={t('sections.legendReference')}
                                  onPress={() => onSetAsReference(fwd.bestActivityId)}
                                />
                              ) : null}
                            </View>
                          ) : null}
                          {rev ? (
                            <View style={styles.calendarMonthEntryRow}>
                              <Pressable
                                style={pressable(styles.calendarMonthEntry)}
                                android_ripple={pressRipple}
                                accessibilityRole="button"
                                accessibilityLabel={`${directionWord(t, 'reverse')}, ${formatBest(rev)}, ${rev.bestActivityName}`}
                                onPress={() => tapTo(`/activity/${rev.bestActivityId}`)}
                              >
                                <DirectionArrow
                                  direction="reverse"
                                  color={REVERSE_COLOR}
                                  size={iconSize.xs}
                                />
                                <Text
                                  style={[
                                    styles.calendarMonthTime,
                                    isDark && styles.textLight,
                                    isMonthRevYearBest && { fontWeight: '700' },
                                  ]}
                                >
                                  {formatBest(rev)}
                                </Text>
                                {isMonthRevYearBest || isMonthRevOverallPr ? (
                                  <MaterialCommunityIcons
                                    name="trophy"
                                    size={iconSize.xs}
                                    color={
                                      isMonthRevOverallPr
                                        ? isDark
                                          ? darkColors.chartGoldMark
                                          : colors.chartGoldMark
                                        : REVERSE_COLOR
                                    }
                                  />
                                ) : null}
                                {isMonthRevOverallPr ? (
                                  <Text style={[styles.prTag, isDark && styles.prTagDark]}>
                                    {t('sections.legendPr')}
                                  </Text>
                                ) : null}
                              </Pressable>
                              {onSetAsReference ? (
                                <ReferenceStar
                                  isReference={rev.bestActivityId === referenceActivityId}
                                  isDark={isDark}
                                  label={t('sections.legendReference')}
                                  onPress={() => onSetAsReference(rev.bestActivityId)}
                                />
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      </View>
                    );
                  })
                : null}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

interface ReferenceStarProps {
  isReference: boolean;
  isDark: boolean;
  label: string;
  onPress: () => void;
}

function ReferenceStar({ isReference, isDark, label, onPress }: ReferenceStarProps) {
  return (
    <Pressable
      testID="calendar-reference-button"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={REFERENCE_HIT_SLOP}
      style={pressable(styles.referenceButton)}
      android_ripple={pressRipple}
    >
      {isReference ? (
        <Text style={[styles.referenceTag, isDark && styles.referenceTagDark]}>{label}</Text>
      ) : null}
      <MaterialCommunityIcons
        name={isReference ? 'star' : 'star-outline'}
        size={iconSize.sm}
        color={
          isReference ? colors.primary : isDark ? darkColors.textSecondary : colors.textSecondary
        }
      />
    </Pressable>
  );
}

const REFERENCE_MIN_WIDTH = 24;
const REFERENCE_HIT_SLOP = slopToMinTapTarget(iconSize.sm, REFERENCE_MIN_WIDTH);
const STATS_LABEL_INSET = spacing.md + iconSize.md + spacing.xs;

const styles = StyleSheet.create({
  textLight: {
    color: colors.textOnDark,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  calendarSection: {},
  calendarYearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  calendarYearRowDark: {},
  calendarYearText: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  calendarYearSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  calendarTrophy: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.xs,
  },
  calendarMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingLeft: STATS_LABEL_INSET,
    paddingRight: spacing.md,
    gap: spacing.sm,
  },
  calendarMonthRowDark: {},
  calendarMonthName: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    width: 36,
  },
  calendarMonthCount: {
    ...typography.caption,
    color: colors.textSecondary,
    width: 24,
    textAlign: 'center',
  },
  calendarMonthEntries: {
    flex: 1,
    gap: spacing.xxs,
  },
  calendarMonthEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  calendarMonthEntry: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  referenceButton: {
    minWidth: REFERENCE_MIN_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  referenceTag: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  referenceTagDark: {
    color: colors.textOnDark,
  },
  calendarMonthTime: {
    ...typography.bodySmallBold,
    color: colors.textPrimary,
    flex: 1,
  },
  // The word beside the trophy. The trophy alone told an overall best from a
  // year's best by hue, which is the one thing a mark may not do on its own.
  prTag: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.chartGoldText,
    marginLeft: spacing.xs,
  },
  prTagDark: {
    color: darkColors.chartGoldText,
  },
});
