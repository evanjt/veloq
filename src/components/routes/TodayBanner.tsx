import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { useTodayWorkout } from '@/hooks/home/useTodayWorkout';
import { useWorkoutSections } from '@/hooks/home/useWorkoutSections';
import { useActivityPatterns } from '@/hooks/home/useActivityPatterns';
import { useWellness } from '@/hooks/fitness';
import {
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  formatDuration,
  formatDurationHuman,
} from '@/lib';
import { WorkoutStepBar } from './WorkoutStepBar';
import { colors, darkColors, spacing, layout, shadows, typography, brand } from '@/theme';
import type { CalendarEvent } from '@/types';
import type { WorkoutSection } from '@/hooks/home/useWorkoutSections';
import type { ActivityPattern } from '@/types';

const PR_RECENCY_DAYS = 7;

const DAY_NAMES_PLURAL = [
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
  'Sundays',
];

/**
 * Routes page banner showing today's context: planned workout, activity patterns, or readiness.
 * Gracefully degrades — shows nothing when there's no relevant content.
 */
export const TodayBanner = React.memo(function TodayBanner() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const { todayWorkout, tomorrowWorkout, isLoading } = useTodayWorkout();
  const { todayPattern } = useActivityPatterns();

  const sportType = todayWorkout?.type ?? tomorrowWorkout?.type ?? todayPattern?.sportType;
  const { sections } = useWorkoutSections(sportType);

  // Readiness from wellness data
  const { data: wellnessData } = useWellness('1m');
  const latestWellness = wellnessData
    ? [...wellnessData].sort((a, b) => b.id.localeCompare(a.id))[0]
    : null;
  const ctl = latestWellness?.ctl ?? latestWellness?.ctlLoad ?? 0;
  const atl = latestWellness?.atl ?? latestWellness?.atlLoad ?? 0;
  const tsb = ctl - atl;
  const formZone = getFormZone(tsb);
  const formColor = FORM_ZONE_COLORS[formZone];
  const formLabel = FORM_ZONE_LABELS[formZone];

  if (isLoading) return null;
  if (!todayWorkout && !tomorrowWorkout && !todayPattern && !latestWellness) return null;

  const isTomorrow = !todayWorkout && !!tomorrowWorkout;
  const workout = todayWorkout ?? tomorrowWorkout;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Readiness header */}
      <View style={styles.readinessRow}>
        <View style={[styles.formDot, { backgroundColor: formColor }]} />
        <Text style={[styles.readinessLabel, isDark && styles.textLight]}>
          {isTomorrow
            ? t('routeIntelligence.tomorrow', 'TOMORROW')
            : t('routeIntelligence.today', 'TODAY')}
        </Text>
        <Text style={[styles.readinessValue, { color: formColor }]}>
          {formLabel} ({tsb > 0 ? '+' : ''}
          {Math.round(tsb)} TSB)
        </Text>
      </View>

      {/* Planned workout */}
      {workout && <WorkoutCard workout={workout} isTomorrow={isTomorrow} isDark={isDark} />}

      {/* Activity pattern (when no workout) */}
      {!workout && todayPattern && <PatternCard pattern={todayPattern} isDark={isDark} />}

      {/* Section highlights (for today's workout or pattern) */}
      {!isTomorrow && sections.length > 0 && (
        <SectionHighlights sections={sections} isDark={isDark} />
      )}
    </View>
  );
});

/** Planned workout summary card */
const WorkoutCard = React.memo(function WorkoutCard({
  workout,
  isTomorrow,
  isDark,
}: {
  workout: CalendarEvent;
  isTomorrow: boolean;
  isDark: boolean;
}) {
  const sportIcon = workout.type === 'Run' ? '\u{1F3C3}' : '\u{1F6B4}';
  const targetLabel =
    workout.target === 'POWER'
      ? 'Power'
      : workout.target === 'HR'
        ? 'HR'
        : workout.target === 'PACE'
          ? 'Pace'
          : '';

  return (
    <View style={[styles.workoutCard, isTomorrow && styles.dimmed]}>
      <Text style={[styles.workoutName, isDark && styles.textLight]}>
        {sportIcon} {workout.name}
      </Text>
      <Text style={[styles.workoutMeta, isDark && styles.textMuted]}>
        {formatDuration(workout.moving_time)}
        {workout.icu_training_load > 0 && ` \u00B7 ${Math.round(workout.icu_training_load)} TSS`}
        {targetLabel && ` \u00B7 ${targetLabel}`}
      </Text>
      {workout.workout_doc?.steps && <WorkoutStepBar steps={workout.workout_doc.steps} />}
    </View>
  );
});

/** Activity pattern summary (shown when no planned workout) */
const PatternCard = React.memo(function PatternCard({
  pattern,
  isDark,
}: {
  pattern: ActivityPattern;
  isDark: boolean;
}) {
  const sportLabel = pattern.sportType === 'Run' ? 'run' : 'ride';
  const dayName = DAY_NAMES_PLURAL[pattern.primaryDay] ?? '';

  return (
    <View style={styles.patternCard}>
      <Text style={[styles.patternText, isDark && styles.textLight]}>
        {dayName} you usually {sportLabel} ~{formatDurationHuman(pattern.avgDurationSecs)}
      </Text>
      {pattern.avgTss > 0 && (
        <Text style={[styles.workoutMeta, isDark && styles.textMuted]}>
          ~{Math.round(pattern.avgTss)} TSS {'\u00B7'} {pattern.activityCount} activities
        </Text>
      )}
    </View>
  );
});

/** Section PR + trend highlights */
const SectionHighlights = React.memo(function SectionHighlights({
  sections,
  isDark,
}: {
  sections: WorkoutSection[];
  isDark: boolean;
}) {
  const { t } = useTranslation();
  const displayed = sections.slice(0, 3);
  const recentPRCount = displayed.filter(
    (s) => s.prTimeSecs != null && s.prDaysAgo != null && s.prDaysAgo <= PR_RECENCY_DAYS
  ).length;

  return (
    <View style={[styles.sectionsContainer, isDark && styles.sectionsContainerDark]}>
      {recentPRCount > 0 && (
        <View style={styles.prSummaryRow}>
          <MaterialCommunityIcons name="trophy-outline" size={14} color={brand.gold} />
          <Text style={styles.prSummaryText}>
            {t('todayBanner.prCountThisWeek', {
              count: recentPRCount,
              defaultValue: '{{count}} section PRs this week',
            })}
          </Text>
        </View>
      )}
      {displayed.map((section) => {
        const hasPR = section.prTimeSecs != null;
        const isRecentPR =
          hasPR && section.prDaysAgo != null && section.prDaysAgo <= PR_RECENCY_DAYS;
        const delta =
          hasPR && section.previousBestTimeSecs != null
            ? section.previousBestTimeSecs - section.prTimeSecs!
            : null;
        const showDelta = delta != null && delta > 0;

        return (
          <TouchableOpacity
            key={section.id}
            style={styles.sectionRow}
            onPress={() => router.push(`/section/${section.id}`)}
          >
            <Text
              style={[
                styles.sectionName,
                isDark && styles.textLight,
                isRecentPR && styles.sectionNamePR,
              ]}
              numberOfLines={1}
            >
              {section.name}
            </Text>
            <View style={styles.sectionMeta}>
              {hasPR && isRecentPR && (
                <View style={styles.prCelebration}>
                  <MaterialCommunityIcons name="trophy" size={12} color={brand.gold} />
                  <Text style={styles.prTextCelebration}>
                    PR {formatDuration(section.prTimeSecs!)}
                  </Text>
                  {showDelta && (
                    <Text style={styles.prDelta}>{` \u2212${formatDuration(delta!)}`}</Text>
                  )}
                </View>
              )}
              {hasPR && !isRecentPR && (
                <Text style={styles.prBadgeAccent}>
                  PR {formatDuration(section.prTimeSecs!)}
                  {showDelta ? ` (\u2212${formatDuration(delta!)})` : ''}
                </Text>
              )}
              {section.trend && (
                <Text style={[styles.trendArrow, getTrendStyle(section.trend)]}>
                  {section.trend === 'improving'
                    ? ' \u2191'
                    : section.trend === 'declining'
                      ? ' \u2193'
                      : ' \u2192'}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

function getTrendStyle(trend: string) {
  if (trend === 'improving') return { color: '#66BB6A' };
  if (trend === 'declining') return { color: '#EF5350' };
  return { color: '#9E9E9E' };
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  containerDark: {
    backgroundColor: darkColors.surfaceCard,
    borderWidth: 1,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  readinessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  formDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  readinessLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginRight: spacing.sm,
  },
  readinessValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  workoutCard: {
    marginBottom: spacing.xs,
  },
  dimmed: {
    opacity: 0.6,
  },
  workoutName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  workoutMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  patternCard: {
    marginBottom: spacing.xs,
  },
  patternText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sectionsContainer: {
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  sectionsContainerDark: {
    borderTopColor: darkColors.border,
  },
  prSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  prSummaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: brand.gold,
    fontVariant: ['tabular-nums'],
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  sectionName: {
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.sm,
  },
  sectionNamePR: {
    fontWeight: '600',
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  prCelebration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  prTextCelebration: {
    fontSize: 13,
    fontWeight: '700',
    color: brand.gold,
    fontVariant: ['tabular-nums'],
  },
  prDelta: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FC4C02',
    fontVariant: ['tabular-nums'],
  },
  prBadge: {
    fontSize: 12,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  prBadgeAccent: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FC4C02',
    fontVariant: ['tabular-nums'],
  },
  trendArrow: {
    fontSize: 13,
    fontWeight: '700',
  },
});
