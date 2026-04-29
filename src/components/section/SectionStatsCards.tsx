/**
 * Calendar performance history for a section.
 * Shows a collapsible year > month breakdown of traversal times and PRs.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { formatDuration, formatPace } from '@/lib';
import { colors, darkColors, spacing, typography, layout } from '@/theme';

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
  traversalCount: number;
  forward?: CalendarDirectionBest;
  reverse?: CalendarDirectionBest;
}

interface CalendarYearSummary {
  year: number;
  traversalCount: number;
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
  activityColor: string;
  onSetAsReference?: (activityId: string) => void;
  referenceActivityId?: string;
}

export function SectionStatsCards({
  calendarSummary,
  isDark,
  isRunning,
  activityColor,
  onSetAsReference,
  referenceActivityId,
}: SectionStatsCardsProps) {
  const { t } = useTranslation();
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
    const formatter = new Intl.DateTimeFormat(undefined, { month: 'short' });
    return Array.from({ length: 12 }, (_, i) => formatter.format(new Date(2024, i, 1)));
  }, []);

  if (calendarSummary.years.length < 1) {
    return null;
  }

  return (
    <View style={[styles.cardContainer, isDark && styles.cardContainerDark]}>
      <View style={styles.calendarSection}>
        {calendarSummary.years.map((yearData) => {
          const isYearExpanded = expandedYears.has(yearData.year);
          const yearFwd = yearData.forward;
          const yearRev = yearData.reverse;
          const yearBest =
            yearFwd && yearRev
              ? yearFwd.bestTime <= yearRev.bestTime
                ? yearFwd
                : yearRev
              : (yearFwd ?? yearRev);
          const yearBestDisplay = yearBest
            ? isRunning
              ? formatPace(yearBest.bestPace)
              : formatDuration(yearBest.bestTime)
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
                style={[styles.calendarYearRow, isDark && styles.calendarYearRowDark]}
                onPress={() => toggleYear(yearData.year)}
              >
                <MaterialCommunityIcons
                  name={isYearExpanded ? 'chevron-down' : 'chevron-right'}
                  size={20}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.calendarYearText, isDark && styles.textLight]}>
                  {yearData.year}
                </Text>
                <Text style={[styles.calendarYearSubtitle, isDark && styles.textMuted]}>
                  {t('sections.traversalsSummary', {
                    count: yearData.traversalCount,
                    time: yearBestDisplay,
                  })}
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
                              style={styles.calendarMonthEntry}
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
                                {isRunning
                                  ? formatPace(fwd.bestPace)
                                  : formatDuration(fwd.bestTime)}
                              </Text>
                              {(isMonthFwdYearBest || isMonthFwdOverallPr) && (
                                <MaterialCommunityIcons
                                  name="trophy"
                                  size={12}
                                  color={isMonthFwdOverallPr ? colors.chartGold : activityColor}
                                />
                              )}
                            </Pressable>
                            {onSetAsReference && (
                              <Pressable
                                onPress={() => onSetAsReference(fwd.bestActivityId)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                style={styles.referenceButton}
                              >
                                <MaterialCommunityIcons
                                  name={
                                    fwd.bestActivityId === referenceActivityId
                                      ? 'star'
                                      : 'star-outline'
                                  }
                                  size={16}
                                  color={
                                    fwd.bestActivityId === referenceActivityId
                                      ? colors.primary
                                      : isDark
                                        ? darkColors.textSecondary
                                        : colors.textSecondary
                                  }
                                />
                              </Pressable>
                            )}
                          </View>
                        )}
                        {rev && (
                          <View style={styles.calendarMonthEntryRow}>
                            <Pressable
                              style={styles.calendarMonthEntry}
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
                                {isRunning
                                  ? formatPace(rev.bestPace)
                                  : formatDuration(rev.bestTime)}
                              </Text>
                              {(isMonthRevYearBest || isMonthRevOverallPr) && (
                                <MaterialCommunityIcons
                                  name="trophy"
                                  size={12}
                                  color={isMonthRevOverallPr ? colors.chartGold : REVERSE_COLOR}
                                />
                              )}
                            </Pressable>
                            {onSetAsReference && (
                              <Pressable
                                onPress={() => onSetAsReference(rev.bestActivityId)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                style={styles.referenceButton}
                              >
                                <MaterialCommunityIcons
                                  name={
                                    rev.bestActivityId === referenceActivityId
                                      ? 'star'
                                      : 'star-outline'
                                  }
                                  size={16}
                                  color={
                                    rev.bestActivityId === referenceActivityId
                                      ? colors.primary
                                      : isDark
                                        ? darkColors.textSecondary
                                        : colors.textSecondary
                                  }
                                />
                              </Pressable>
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
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  cardContainerDark: {
    backgroundColor: darkColors.surfaceCard,
  },
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
    paddingLeft: spacing.md + 20 + spacing.xs,
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
    gap: 2,
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
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDirDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  calendarMonthTime: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
});
