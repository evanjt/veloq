/**
 * Calendar performance history for a section.
 * Shows a collapsible year > month breakdown of traversal times and PRs.
 */

import { useMetricSystem } from '@/shared/app';
import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@/shared/format/format';
import { formatAttemptFigure, type AttemptBasis } from '@/features/routes/lib/attemptBasis';
import { colors, darkColors, iconSize, spacing, themePalette, typography } from '@/theme';
import { Card, CardHeader, DisclosureChevron, IconButton, PressTarget } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useOpenDetail } from '@/shared/app/MapSheetCards';
import { directionColour } from '@/features/routes/lib/directionColour';
import { DirectionArrow, directionWord } from './DirectionCue';

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
  onSetAsReference,
  referenceActivityId,
  recordsSettled = true,
}: SectionStatsCardsProps) {
  const { t } = useTranslation();
  const openDetail = useOpenDetail();
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
  // The trophy marks the record and nothing else, in the one gold on every
  // row. A year's best that is not the record is told by its bold time.
  const recordGold = themePalette(isDark).achievement;
  const forwardColour = directionColour('forward', isDark);
  const reverseColour = directionColour('reverse', isDark);

  return (
    <Card variant="flat" padding="none" testID="section-calendar">
      {/* The rows run to the card's edge, so the title takes the row inset. */}
      <View style={styles.calendarHeader}>
        <CardHeader title={t('sections.calendarTitle')} testID="section-calendar-header" />
      </View>
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
              <PressTarget
                style={[styles.calendarYearRow, isDark && styles.calendarYearRowDark]}
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
                        color={forwardColour}
                        size={iconSize.xs}
                      />
                      {` ${directionWord(t, 'forward')} `}
                      <Text testID={`year-best-forward-${yearData.year}`}>
                        {formatYearBest(yearFwd)}
                      </Text>
                      {'  '}
                      <DirectionArrow
                        direction="reverse"
                        color={reverseColour}
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
                    <Icon name="trophy" size={iconSize.sm} color={recordGold} />
                    {yearRev ? (
                      <DirectionArrow
                        direction="forward"
                        color={forwardColour}
                        size={iconSize.xs}
                      />
                    ) : null}
                  </View>
                ) : null}
                {isYearRevPr ? (
                  <View style={styles.calendarTrophy}>
                    <Icon name="trophy" size={iconSize.sm} color={recordGold} />
                    {yearFwd ? (
                      <DirectionArrow
                        direction="reverse"
                        color={reverseColour}
                        size={iconSize.xs}
                      />
                    ) : null}
                  </View>
                ) : null}
              </PressTarget>
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
                        <Text
                          style={[styles.calendarMonthCount, isDark && styles.textSecondary]}
                          numberOfLines={2}
                        >
                          {t('sections.traversalsCount', { count: monthData.traversalCount })}
                        </Text>
                        <View style={styles.calendarMonthEntries}>
                          {fwd ? (
                            <View style={styles.calendarMonthEntryRow}>
                              <PressTarget
                                style={styles.calendarMonthEntry}
                                accessibilityRole="button"
                                accessibilityLabel={`${directionWord(t, 'forward')}, ${formatBest(fwd)}, ${fwd.bestActivityName}`}
                                onPress={() =>
                                  openDetail({ kind: 'activity', id: fwd.bestActivityId })
                                }
                              >
                                <DirectionArrow
                                  direction="forward"
                                  color={forwardColour}
                                  size={iconSize.xs}
                                />
                                <Text
                                  testID="calendar-month-time"
                                  style={[
                                    styles.calendarMonthTime,
                                    isDark && styles.textLight,
                                    isMonthFwdYearBest && styles.calendarMonthTimeBest,
                                  ]}
                                >
                                  {formatBest(fwd)}
                                </Text>
                                {isMonthFwdOverallPr ? (
                                  <Icon name="trophy" size={iconSize.xs} color={recordGold} />
                                ) : null}
                                {isMonthFwdOverallPr ? (
                                  <Text style={[styles.prTag, isDark && styles.prTagDark]}>
                                    {t('sections.legendPr')}
                                  </Text>
                                ) : null}
                                {onSetAsReference && fwd.bestActivityId === referenceActivityId ? (
                                  <Text
                                    style={[styles.referenceTag, isDark && styles.textSecondary]}
                                  >
                                    {t('sections.legendReference')}
                                  </Text>
                                ) : null}
                              </PressTarget>
                              {onSetAsReference ? (
                                <ReferenceStar
                                  isReference={fwd.bestActivityId === referenceActivityId}
                                  onPress={() => onSetAsReference(fwd.bestActivityId)}
                                />
                              ) : null}
                            </View>
                          ) : null}
                          {rev ? (
                            <View style={styles.calendarMonthEntryRow}>
                              <PressTarget
                                style={styles.calendarMonthEntry}
                                accessibilityRole="button"
                                accessibilityLabel={`${directionWord(t, 'reverse')}, ${formatBest(rev)}, ${rev.bestActivityName}`}
                                onPress={() =>
                                  openDetail({ kind: 'activity', id: rev.bestActivityId })
                                }
                              >
                                <DirectionArrow
                                  direction="reverse"
                                  color={reverseColour}
                                  size={iconSize.xs}
                                />
                                <Text
                                  testID="calendar-month-time"
                                  style={[
                                    styles.calendarMonthTime,
                                    isDark && styles.textLight,
                                    isMonthRevYearBest && styles.calendarMonthTimeBest,
                                  ]}
                                >
                                  {formatBest(rev)}
                                </Text>
                                {isMonthRevOverallPr ? (
                                  <Icon name="trophy" size={iconSize.xs} color={recordGold} />
                                ) : null}
                                {isMonthRevOverallPr ? (
                                  <Text style={[styles.prTag, isDark && styles.prTagDark]}>
                                    {t('sections.legendPr')}
                                  </Text>
                                ) : null}
                                {onSetAsReference && rev.bestActivityId === referenceActivityId ? (
                                  <Text
                                    style={[styles.referenceTag, isDark && styles.textSecondary]}
                                  >
                                    {t('sections.legendReference')}
                                  </Text>
                                ) : null}
                              </PressTarget>
                              {onSetAsReference ? (
                                <ReferenceStar
                                  isReference={rev.bestActivityId === referenceActivityId}
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
  onPress: () => void;
}

/**
 * The reference attempt's star is filled, any other best's is an outline that
 * offers to become it. Icon-only in the small square, so the month's time
 * keeps the width; the row's text tag and the label say which it is.
 */
function ReferenceStar({ isReference, onPress }: ReferenceStarProps) {
  const { t } = useTranslation();
  return (
    <IconButton
      testID="calendar-reference-button"
      accessibilityLabel={
        isReference ? t('sections.legendReference') : t('sections.setAsReference')
      }
      compact
      onPress={onPress}
    >
      <IconButton.Glyph name={isReference ? 'star' : 'star-outline'} size={iconSize.sm} />
    </IconButton>
  );
}

// Room for "12 traversals" on one line; a longer word wraps to a second.
const MONTH_COUNT_WIDTH = 72;
const STATS_LABEL_INSET = spacing.md + iconSize.md + spacing.xs;

const styles = StyleSheet.create({
  textLight: {
    color: colors.textOnFill,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  calendarHeader: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
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
    width: MONTH_COUNT_WIDTH,
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
  // The time fills the entry but never shrinks below its own width; the tags
  // after it give way first.
  calendarMonthTime: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    flexGrow: 1,
    flexShrink: 0,
  },
  calendarMonthTimeBest: {
    ...typography.bodySmallBold,
  },
  // The word beside the trophy. The trophy alone told an overall best from a
  // year's best by hue, which is the one thing a mark may not do on its own.
  prTag: {
    ...typography.captionBold,
    color: colors.achievementText,
    marginLeft: spacing.xs,
  },
  prTagDark: {
    color: darkColors.achievementText,
  },
  referenceTag: {
    ...typography.captionBold,
    color: colors.textSecondary,
    flexShrink: 1,
  },
});
