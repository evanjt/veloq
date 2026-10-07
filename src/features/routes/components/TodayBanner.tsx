import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useTodayWorkout, useWorkoutSections, type WorkoutSection } from '@/features/home';
import {
  getFormZone,
  formatForm,
  FORM_ZONE_COLORS,
  formZoneTextColor,
  formZoneLabel,
} from '@/features/fitness';
import { formatDuration, isolateNumeric } from '@/shared/format/format';
import { formFromLoads } from '@/shared/math';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { WorkoutStepBar } from './WorkoutStepBar';
import {
  colors,
  darkColors,
  spacing,
  layout,
  shadows,
  brand,
  verdictColor,
  typography,
} from '@/theme';
import type { CalendarEvent } from '@/types';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { pressable, pressRipple } from '@/shared/ui';

const PR_RECENCY_DAYS = 7;

interface TodayBannerProps {
  /**
   * The newest form reading from the same bundle, or null when the window
   * holds no wellness row. Without one the readiness row is not drawn.
   */
  form: { ctl: number; atl: number } | null;
}

/**
 * Routes page banner showing today's context: planned workout or readiness.
 * Gracefully degrades - shows nothing when there's no relevant content.
 */
export const TodayBanner = React.memo(function TodayBanner({ form: formLoads }: TodayBannerProps) {
  const { isDark } = useTheme();
  const { todayWorkout, tomorrowWorkout, isLoading } = useTodayWorkout();

  const sportType = todayWorkout?.type ?? tomorrowWorkout?.type;
  const { sections } = useWorkoutSections(sportType);

  if (isLoading) return null;
  if (!todayWorkout && !tomorrowWorkout && !formLoads) return null;

  const isTomorrow = !todayWorkout && !!tomorrowWorkout;
  const workout = todayWorkout ?? tomorrowWorkout;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Readiness header */}
      {formLoads && <ReadinessRow loads={formLoads} isTomorrow={isTomorrow} isDark={isDark} />}

      {/* Planned workout */}
      {workout && <WorkoutCard workout={workout} isTomorrow={isTomorrow} isDark={isDark} />}

      {/* Section highlights (for today's workout) */}
      {!isTomorrow && sections.length > 0 && (
        <SectionHighlights sections={sections} isDark={isDark} />
      )}
    </View>
  );
});

/** Readiness header: the form zone and figure for one pair of loads */
const ReadinessRow = React.memo(function ReadinessRow({
  loads,
  isTomorrow,
  isDark,
}: {
  loads: { ctl: number; atl: number };
  isTomorrow: boolean;
  isDark: boolean;
}) {
  const { t } = useTranslation();
  const asPercent = useFormPreference((s) => s.formAsPercent) === true;
  const { ctl, atl } = loads;
  const form = formFromLoads(ctl, atl);
  const formZone = getFormZone(ctl - atl, ctl, asPercent);
  const formColor = formZone ? FORM_ZONE_COLORS[formZone] : 'transparent';
  const formTextColor = formZone ? formZoneTextColor(formZone, isDark) : undefined;
  const formLabel = formZone ? formZoneLabel(formZone) : '';
  const formValue = formatForm(form, ctl, asPercent);

  return (
    <View style={styles.readinessRow}>
      <View style={[styles.formDot, { backgroundColor: formColor }]} />
      <Text style={[styles.readinessLabel, isDark && styles.textLight]}>
        {isTomorrow
          ? t('routeIntelligence.tomorrow', 'TOMORROW')
          : t('routeIntelligence.today', 'TODAY')}
      </Text>
      <Text style={[styles.readinessValue, { color: formTextColor }]}>
        {formLabel}
        {formValue !== null && ` (${isolateNumeric(formValue)}${asPercent ? '' : ' TSB'})`}
      </Text>
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
  const { t } = useTranslation();
  const targetLabel =
    workout.target === 'POWER'
      ? t('routes.targetPower')
      : workout.target === 'HR'
        ? t('routes.targetHr')
        : workout.target === 'PACE'
          ? t('routes.targetPace')
          : '';

  return (
    <View style={[styles.workoutCard, isTomorrow && styles.dimmed]}>
      <Text style={[styles.workoutName, isDark && styles.textLight]}>
        <MaterialCommunityIcons
          name={getActivityIcon(workout.type)}
          size={typography.body.fontSize}
          color={isDark ? darkColors.textPrimary : colors.textPrimary}
        />{' '}
        {workout.name}
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
        const prTimeSecs = section.prTimeSecs ?? null;
        const isRecentPR =
          prTimeSecs != null && section.prDaysAgo != null && section.prDaysAgo <= PR_RECENCY_DAYS;
        const delta =
          prTimeSecs != null && section.previousBestTimeSecs != null
            ? section.previousBestTimeSecs - prTimeSecs
            : null;
        const gain = delta != null && delta > 0 ? delta : null;

        return (
          <Pressable
            key={section.id}
            style={pressable(styles.sectionRow)}
            android_ripple={pressRipple}
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
              {prTimeSecs != null && isRecentPR && (
                <View style={styles.prCelebration}>
                  <MaterialCommunityIcons name="trophy" size={12} color={brand.gold} />
                  <Text style={styles.prTextCelebration}>PR {formatDuration(prTimeSecs)}</Text>
                  {gain != null && (
                    <Text style={styles.prDelta}>{` \u2212${formatDuration(gain)}`}</Text>
                  )}
                </View>
              )}
              {prTimeSecs != null && !isRecentPR && (
                <Text style={styles.prBadgeAccent}>
                  PR {formatDuration(prTimeSecs)}
                  {gain != null ? ` (\u2212${formatDuration(gain)})` : ''}
                </Text>
              )}
              {section.trend && (
                <Text style={[styles.trendArrow, getTrendStyle(section.trend, isDark)]}>
                  {section.trend === 'improving'
                    ? ' \u2191'
                    : section.trend === 'declining'
                      ? ' \u2193'
                      : ' \u2192'}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
});

export function getTrendStyle(trend: string, isDark: boolean) {
  if (trend === 'improving') return { color: verdictColor('positive', isDark) };
  if (trend === 'declining') return { color: verdictColor('negative', isDark) };
  return { color: verdictColor('neutral', isDark) };
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
    borderRadius: layout.borderRadiusFull,
    marginRight: spacing.xs,
  },
  readinessLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginRight: spacing.sm,
  },
  readinessValue: {
    fontSize: typography.caption.fontSize,
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
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  workoutMeta: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
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
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  prSummaryText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: brand.gold,
    fontVariant: ['tabular-nums'],
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  sectionName: {
    fontSize: typography.bodyCompact.fontSize,
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
    gap: spacing.xs,
  },
  prTextCelebration: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '700',
    color: brand.gold,
    fontVariant: ['tabular-nums'],
  },
  prDelta: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: brand.tealLight,
    fontVariant: ['tabular-nums'],
  },
  prBadgeAccent: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: brand.tealLight,
    fontVariant: ['tabular-nums'],
  },
  trendArrow: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '700',
  },
});
