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
import { router } from 'expo-router';
import { formatDuration, formatPace, formatSwimPace, getIntlLocale } from '@/shared/format/format';
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import { Card, pressable, pressRipple } from '@/shared/ui';

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
  isRunning: boolean;
  isSwimming?: boolean | undefined;
  activityColor: string;
  onSetAsReference?: ((activityId: string) => void) | undefined;
  referenceActivityId?: string | undefined;
}

export function SectionStatsCards({
  calendarSummary,
  isDark,
  isRunning,
  isSwimming = false,
  activityColor,
  onSetAsReference,
  referenceActivityId,
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

  if (calendarSummary.years.length < 1) {
    return null;
  }

  return (
    <Card variant="flat" padding="none">
      <View style={styles.calendarSection}>
        {calendarSummary.years.map((yearData) => {
          const isYearExpanded = expandedYears.has(yearData.year);
          const yearFwd = yearData.forward;
          const yearRev = yearData.reverse;
          const formatYearBest = (entry: typeof yearFwd) =>
            entry
              ? isSwimming
                ? formatSwimPace(entry.bestPace, isMetric)
                : isRunning
                  ? formatPace(entry.bestPace, isMetric)
                  : formatDuration(entry.bestTime)
              : '';
          const isYearFwdPr =
            yearFwd &&
            calendarSummary.forwardPr &&
            yearFwd.bestActivityId === calendarSummary.forwardPr.bestActivityId;
          const isYearRevPr =
            yearRev &&
            calendarSummary.reversePr &&
            yearRev.bestActivityId === calendarSummary.reversePr.bestActivityId;

          return (
            <View key={yearData.year}>
              <Pressable
                style={pressable([styles.calendarYearRow, isDark && styles.calendarYearRowDark])}
                android_ripple={pressRipple}
                onPress={() => toggleYear(yearData.year)}
              >
                <MaterialCommunityIcons
                  name={isYearExpanded ? 'chevron-down' : 'chevron-right'}
                  size={STATS_ICON_SIZE}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.calendarYearText, isDark && styles.textLight]}>
                  {yearData.year}
                </Text>
                <Text style={[styles.calendarYearSubtitle, isDark && styles.textMuted]}>
                  {yearFwd && yearRev ? (
                    <>
                      {`${t('sections.traversalsCount', { count: yearData.traversalCount })} · `}
                      <Text style={{ color: activityColor }}>{'● '}</Text>
                      <Text testID={`year-best-forward-${yearData.year}`}>
                        {formatYearBest(yearFwd)}
                      </Text>
                      {'  '}
                      <Text style={{ color: REVERSE_COLOR }}>{'● '}</Text>
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
                {isYearFwdPr && (
                  <MaterialCommunityIcons
                    name="trophy"
                    size={14}
                    color={activityColor}
                    style={styles.calendarTrophy}
                  />
                )}
                {isYearRevPr && (
                  <MaterialCommunityIcons
                    name="trophy"
                    size={14}
                    color={REVERSE_COLOR}
                    style={styles.calendarTrophy}
                  />
                )}
              </Pressable>
              {isYearExpanded &&
                yearData.months.map((monthData) => {
                  const fwd = monthData.forward;
                  const rev = monthData.reverse;
                  const isMonthFwdYearBest =
                    fwd && yearFwd && fwd.bestActivityId === yearFwd.bestActivityId;
                  const isMonthRevYearBest =
                    rev && yearRev && rev.bestActivityId === yearRev.bestActivityId;
                  const isMonthFwdOverallPr =
                    fwd &&
                    calendarSummary.forwardPr &&
                    fwd.bestActivityId === calendarSummary.forwardPr.bestActivityId;
                  const isMonthRevOverallPr =
                    rev &&
                    calendarSummary.reversePr &&
                    rev.bestActivityId === calendarSummary.reversePr.bestActivityId;

                  return (
                    <View
                      key={monthData.month}
                      style={[styles.calendarMonthRow, isDark && styles.calendarMonthRowDark]}
                    >
                      <Text style={[styles.calendarMonthName, isDark && styles.textMuted]}>
                        {monthNames[monthData.month - 1]}
                      </Text>
                      <Text style={[styles.calendarMonthCount, isDark && styles.textMuted]}>
                        {monthData.traversalCount}
                      </Text>
                      <View style={styles.calendarMonthEntries}>
                        {fwd && (
                          <View style={styles.calendarMonthEntryRow}>
                            <Pressable
                              style={pressable(styles.calendarMonthEntry)}
                              android_ripple={pressRipple}
                              onPress={() => router.push(`/activity/${fwd.bestActivityId}`)}
                            >
                              <View
                                style={[styles.calendarDirDot, { backgroundColor: activityColor }]}
                              />
                              <Text
                                style={[
                                  styles.calendarMonthTime,
                                  isDark && styles.textLight,
                                  isMonthFwdYearBest && { fontWeight: '700' },
                                ]}
                              >
                                {isSwimming
                                  ? formatSwimPace(fwd.bestPace, isMetric)
                                  : isRunning
                                    ? formatPace(fwd.bestPace, isMetric)
                                    : formatDuration(fwd.bestTime)}
                              </Text>
                              {(isMonthFwdYearBest || isMonthFwdOverallPr) && (
                                <MaterialCommunityIcons
                                  name="trophy"
                                  size={12}
                                  color={
                                    isMonthFwdOverallPr
                                      ? isDark
                                        ? darkColors.chartGoldMark
                                        : colors.chartGoldMark
                                      : activityColor
                                  }
                                />
                              )}
                              {isMonthFwdOverallPr && (
                                <Text style={[styles.prTag, isDark && styles.prTagDark]}>
                                  {t('sections.legendPr')}
                                </Text>
                              )}
                            </Pressable>
                            {onSetAsReference && (
                              <ReferenceStar
                                isReference={fwd.bestActivityId === referenceActivityId}
                                isDark={isDark}
                                label={t('sections.legendReference')}
                                onPress={() => onSetAsReference(fwd.bestActivityId)}
                              />
                            )}
                          </View>
                        )}
                        {rev && (
                          <View style={styles.calendarMonthEntryRow}>
                            <Pressable
                              style={pressable(styles.calendarMonthEntry)}
                              android_ripple={pressRipple}
                              onPress={() => router.push(`/activity/${rev.bestActivityId}`)}
                            >
                              <View
                                style={[styles.calendarDirDot, { backgroundColor: REVERSE_COLOR }]}
                              />
                              <Text
                                style={[
                                  styles.calendarMonthTime,
                                  isDark && styles.textLight,
                                  isMonthRevYearBest && { fontWeight: '700' },
                                ]}
                              >
                                {isSwimming
                                  ? formatSwimPace(rev.bestPace, isMetric)
                                  : isRunning
                                    ? formatPace(rev.bestPace, isMetric)
                                    : formatDuration(rev.bestTime)}
                              </Text>
                              {(isMonthRevYearBest || isMonthRevOverallPr) && (
                                <MaterialCommunityIcons
                                  name="trophy"
                                  size={12}
                                  color={
                                    isMonthRevOverallPr
                                      ? isDark
                                        ? darkColors.chartGoldMark
                                        : colors.chartGoldMark
                                      : REVERSE_COLOR
                                  }
                                />
                              )}
                              {isMonthRevOverallPr && (
                                <Text style={[styles.prTag, isDark && styles.prTagDark]}>
                                  {t('sections.legendPr')}
                                </Text>
                              )}
                            </Pressable>
                            {onSetAsReference && (
                              <ReferenceStar
                                isReference={rev.bestActivityId === referenceActivityId}
                                isDark={isDark}
                                label={t('sections.legendReference')}
                                onPress={() => onSetAsReference(rev.bestActivityId)}
                              />
                            )}
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
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
      {isReference && (
        <Text style={[styles.referenceTag, isDark && styles.referenceTagDark]}>{label}</Text>
      )}
      <MaterialCommunityIcons
        name={isReference ? 'star' : 'star-outline'}
        size={16}
        color={
          isReference ? colors.primary : isDark ? darkColors.textSecondary : colors.textSecondary
        }
      />
    </Pressable>
  );
}

const REFERENCE_HIT_SLOP = { top: 12, bottom: 12, left: 8, right: 8 };
const STATS_ICON_SIZE = 20;
const STATS_LABEL_INSET = spacing.md + STATS_ICON_SIZE + spacing.xs;

const styles = StyleSheet.create({
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
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
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  calendarYearSubtitle: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    flex: 1,
  },
  calendarTrophy: {
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
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    width: 36,
  },
  calendarMonthCount: {
    fontSize: typography.caption.fontSize,
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
    minWidth: 24,
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
  calendarDirDot: {
    width: 8,
    height: 8,
    borderRadius: layout.borderRadiusFull,
  },
  calendarMonthTime: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
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
