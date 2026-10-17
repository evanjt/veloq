import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useTodayWorkout, useWorkoutSections, type WorkoutSection } from '@/features/home';
import {
  formZoneFromLoads,
  formatForm,
  FORM_ZONE_COLORS,
  formZoneTextColor,
  formZoneLabel,
} from '@/features/fitness';
import { formatDuration, formatLoad, isolateNumeric } from '@/shared/format/format';
import { formFromLoads } from '@/shared/math';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { WorkoutStepBar } from './WorkoutStepBar';
import {
  brand,
  colors,
  darkColors,
  iconSize,
  layout,
  opacity,
  shadows,
  spacing,
  typography,
  verdictColor,
  stroke,
} from '@/theme';
import type { CalendarEvent } from '@/types';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { pressable, pressRipple } from '@/shared/ui';
import { tapTo } from '@/shared/app/navigation';

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
      {formLoads ? (
        <ReadinessRow loads={formLoads} isTomorrow={isTomorrow} isDark={isDark} />
      ) : null}

      {/* Planned workout */}
      {workout ? <WorkoutCard workout={workout} isTomorrow={isTomorrow} isDark={isDark} /> : null}

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
  const formZone = formZoneFromLoads(ctl, atl, asPercent);
  const formColor = formZone ? FORM_ZONE_COLORS[formZone] : 'transparent';
  const formTextColor = formZone ? formZoneTextColor(formZone, isDark) : undefined;
  const formLabel = formZone ? formZoneLabel(formZone) : '';
  const formValue = formatForm(form, Math.round(ctl), asPercent);

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
        {formValue !== null &&
          ` \u00B7 ${t(asPercent ? 'metrics.form' : 'activity.stats.formTSB')} ${isolateNumeric(formValue)}`}
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
          size={iconSize.md}
          color={isDark ? darkColors.textPrimary : colors.textPrimary}
        />{' '}
        {workout.name}
      </Text>
      <Text style={[styles.workoutMeta, isDark && styles.textSecondary]}>
        {formatDuration(workout.moving_time)}
        {workout.icu_training_load > 0 &&
          ` \u00B7 ${t('metrics.trainingLoad')} ${formatLoad(workout.icu_training_load)}`}
        {targetLabel ? ` \u00B7 ${targetLabel}` : null}
      </Text>
      {workout.workout_doc?.steps ? <WorkoutStepBar steps={workout.workout_doc.steps} /> : null}
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
          <MaterialCommunityIcons name="trophy-outline" size={iconSize.sm} color={brand.gold} />
          <Text style={[styles.prSummaryText, isDark && styles.prGoldDark]}>
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
            onPress={() => tapTo(`/section/${section.id}`)}
            accessibilityRole="button"
            accessibilityLabel={section.name}
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
              {prTimeSecs != null && isRecentPR ? (
                <View style={styles.prCelebration}>
                  <MaterialCommunityIcons name="trophy" size={iconSize.sm} color={brand.gold} />
                  <Text style={[styles.prTextCelebration, isDark && styles.prGoldDark]}>
                    {t('routes.prTime', { time: formatDuration(prTimeSecs) })}
                  </Text>
                  {gain != null && (
                    <Text
                      style={[styles.prDelta, isDark && styles.accentTextDark]}
                    >{` -${formatDuration(gain)}`}</Text>
                  )}
                </View>
              ) : null}
              {prTimeSecs != null && !isRecentPR && (
                <Text style={[styles.prBadgeAccent, isDark && styles.accentTextDark]}>
                  {t('routes.prTime', { time: formatDuration(prTimeSecs) })}
                  {gain != null ? ` (-${formatDuration(gain)})` : ''}
                </Text>
              )}
              {section.trend ? (
                <Text style={[styles.trendArrow, getTrendStyle(section.trend, isDark)]}>
                  {section.trend === 'improving'
                    ? ' \u2191'
                    : section.trend === 'declining'
                      ? ' \u2193'
                      : ' \u2192'}
                </Text>
              ) : null}
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
    borderWidth: stroke.one,
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
    ...typography.captionBold,
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginRight: spacing.sm,
  },
  readinessValue: {
    ...typography.captionBold,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  workoutCard: {
    marginBottom: spacing.xs,
  },
  dimmed: {
    opacity: opacity.dim,
  },
  workoutName: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  workoutMeta: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  sectionsContainer: {
    marginTop: spacing.sm,
    borderTopWidth: stroke.hairline,
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
    ...typography.captionBold,
    color: colors.chartGoldText,
    fontVariant: ['tabular-nums'],
  },
  prGoldDark: {
    color: darkColors.chartGoldText,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    minHeight: layout.minTapTarget,
  },
  sectionName: {
    ...typography.bodyCompact,
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
    color: colors.chartGoldText,
    fontVariant: ['tabular-nums'],
  },
  prDelta: {
    ...typography.captionBold,
    color: colors.linkTeal,
    fontVariant: ['tabular-nums'],
  },
  prBadgeAccent: {
    ...typography.captionBold,
    color: colors.linkTeal,
    fontVariant: ['tabular-nums'],
  },
  accentTextDark: {
    color: darkColors.linkTeal,
  },
  trendArrow: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '700',
  },
});
