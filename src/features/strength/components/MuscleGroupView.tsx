import React, { useState, useCallback, useMemo } from 'react';
import { Pressable, View, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { ExerciseSet } from 'veloqrs';

import { useMetricSystem } from '@/shared/app';
import { engineErrorKey } from '@/shared/native/engineError';
import { formatDateTime, formatDuration } from '@/shared/format/format';
import {
  colors,
  darkColors,
  spacing,
  typography,
  brand,
  loupeChrome,
  layout,
  colorWithOpacity,
  ink,
  mapTextShadow,
} from '@/theme';
import type { ActivityDetail } from '@/types';

import { useMuscleGroups } from '../hooks/useExerciseSets';
import { useMuscleDetail } from '../hooks/useMuscleDetail';
import { formatWeight } from '@/shared/format/weight';
import { BodyPairWithLoupe } from './BodyPairWithLoupe';
import { pressable, pressRipple } from '@/shared/ui';

interface MuscleGroupViewProps {
  activityId: string;
  activity: ActivityDetail;
  hasExercises: boolean;
  isDark: boolean;
  athleteSex?: string | undefined;
  exerciseSets?: ExerciseSet[];
}

const PRIMARY_COLOR = brand.tealLight;
const SECONDARY_COLOR = brand.tealDark;
const BODY_COLORS: readonly string[] = [SECONDARY_COLOR, PRIMARY_COLOR] as const;

export function MuscleGroupView({
  activityId,
  activity,
  hasExercises,
  isDark,
  athleteSex,
  exerciseSets,
}: MuscleGroupViewProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isMetric = useMetricSystem();
  const { data: muscleGroups, error: muscleGroupsError } = useMuscleGroups(
    activityId,
    hasExercises
  );
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const muscleDetail = useMuscleDetail(activityId, selectedMuscle);

  const handleMuscleTap = useCallback(
    (slug: string) => {
      if ((exerciseSets ?? []).length > 0) {
        setSelectedMuscle((prev) => (prev === slug ? null : slug));
      }
    },
    [exerciseSets]
  );

  // During loupe scrub, always set (no toggle) to avoid flickering
  const handleMuscleScrub = useCallback((slug: string) => {
    setSelectedMuscle(slug);
  }, []);

  const bodyData: ExtendedBodyPart[] = useMemo(
    () =>
      (muscleGroups ?? []).map((g) => ({
        slug: g.slug as NonNullable<ExtendedBodyPart['slug']>,
        intensity: g.intensity,
      })),
    [muscleGroups]
  );

  const tappableSlugs = useMemo(
    () => new Set((muscleGroups ?? []).map((g) => g.slug)),
    [muscleGroups]
  );

  const gender = athleteSex === 'F' ? 'female' : 'male';
  const hasInteractiveData = (exerciseSets ?? []).length > 0 && tappableSlugs.size > 0;

  return (
    <View style={[styles.hero, isDark && styles.heroDark]}>
      <Stack.Screen
        options={{ headerTintColor: isDark ? colors.textOnDark : colors.textPrimary }}
      />

      {/* Body diagrams with unified loupe + center column */}
      <View style={[styles.bodyContainer, { paddingTop: insets.top + 40 }]}>
        <BodyPairWithLoupe
          data={bodyData}
          selectedSlug={selectedMuscle}
          gender={gender}
          scale={0.65}
          colors={BODY_COLORS}
          onMuscleTap={hasInteractiveData ? handleMuscleTap : undefined}
          onMuscleScrub={hasInteractiveData ? handleMuscleScrub : undefined}
          tappableSlugs={tappableSlugs}
          centerWidth={120}
          centerContent={
            <View style={styles.centerColumn}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: PRIMARY_COLOR }]} />
                <Text style={styles.legendText}>{t('activityDetail.primary')}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: SECONDARY_COLOR }]} />
                <Text style={styles.legendText}>{t('activityDetail.secondary')}</Text>
              </View>

              {muscleGroupsError ? (
                <Text testID="muscle-groups-failure" style={styles.legendText}>
                  {t(engineErrorKey(muscleGroupsError, 'engine.failure.database'))}
                </Text>
              ) : null}

              {muscleDetail ? (
                <>
                  <View style={styles.detailDivider} />
                  <View style={styles.detailHeaderRow}>
                    <View
                      style={[
                        styles.detailDot,
                        {
                          backgroundColor:
                            muscleDetail.primaryExercises > 0 ? PRIMARY_COLOR : SECONDARY_COLOR,
                        },
                      ]}
                    />
                    <Text
                      style={[styles.detailName, isDark && styles.detailNameDark]}
                      numberOfLines={1}
                    >
                      {muscleDetail.name}
                    </Text>
                    <Pressable
                      onPress={() => setSelectedMuscle(null)}
                      hitSlop={16}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.close', 'Close')}
                      style={pressable()}
                      android_ripple={pressRipple}
                    >
                      <MaterialCommunityIcons
                        name="close"
                        size={12}
                        color={isDark ? darkColors.textMuted : colors.textDisabled}
                      />
                    </Pressable>
                  </View>
                  <Text style={[styles.detailStat, isDark && styles.detailStatDark]}>
                    {t('activity.muscle.setCount', {
                      count: muscleDetail.totalSets,
                    })}{' '}
                    ·{' '}
                    {t('activity.muscle.repsCount', {
                      count: muscleDetail.totalReps,
                    })}
                  </Text>
                  {muscleDetail.volumeKg > 0 && (
                    <Text style={[styles.detailStat, isDark && styles.detailStatDark]}>
                      {formatWeight(Math.round(muscleDetail.volumeKg), isMetric)}
                    </Text>
                  )}
                  <ScrollView
                    style={styles.detailExList}
                    showsVerticalScrollIndicator={muscleDetail.exercises.length > 3}
                    nestedScrollEnabled
                  >
                    {muscleDetail.exercises.map((ex, idx) => (
                      <View key={`${ex.name}-${idx}`} style={styles.detailExItem}>
                        <View style={styles.detailExNameRow}>
                          <View
                            style={[
                              styles.detailExDot,
                              {
                                backgroundColor:
                                  ex.role === 'primary' ? PRIMARY_COLOR : SECONDARY_COLOR,
                              },
                            ]}
                          />
                          <Text
                            style={[styles.detailExName, isDark && styles.detailExNameDark]}
                            numberOfLines={1}
                          >
                            {ex.name}
                          </Text>
                        </View>
                        <Text style={[styles.detailExSub, isDark && styles.detailExSubDark]}>
                          {t('activity.muscle.setCount', { count: ex.sets })} ·{' '}
                          {t('activity.muscle.repsCount', { count: ex.reps })}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </>
              ) : hasInteractiveData ? (
                <Text style={styles.hintText}>
                  {t('activityDetail.tapMuscle', 'Tap for details')}
                </Text>
              ) : null}
            </View>
          }
        />
      </View>

      {/* Bottom gradient + activity info overlay */}
      <LinearGradient
        colors={['transparent', colorWithOpacity(ink.black, isDark ? 0.7 : 0.15)]}
        style={styles.gradient}
        pointerEvents="none"
      />
      <View style={styles.infoOverlay} pointerEvents="none">
        <Text style={[styles.activityName, !isDark && styles.activityNameLight]} numberOfLines={1}>
          {activity.name}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.activityDate, !isDark && styles.activityDateLight]}>
            {formatDateTime(activity.start_date_local)}
          </Text>
          <Text style={[styles.durationStat, !isDark && styles.durationStatLight]}>
            {formatDuration(activity.moving_time)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const MUSCLE_VIEW_BOTTOM_PADDING = spacing.xl + spacing.lg;

const styles = StyleSheet.create({
  hero: {
    position: 'relative',
    backgroundColor: loupeChrome.bgLight,
  },
  heroDark: {
    backgroundColor: loupeChrome.bgDark,
  },
  bodyContainer: {
    paddingHorizontal: spacing.sm,
    paddingBottom: MUSCLE_VIEW_BOTTOM_PADDING,
  },
  centerColumn: {
    width: 120,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xl,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: layout.borderRadiusFull,
  },
  legendText: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
  hintText: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textDisabled,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  detailDivider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: colorWithOpacity(ink.black, 0.15),
    marginVertical: spacing.xs,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailDot: {
    width: 8,
    height: 8,
    borderRadius: layout.borderRadiusFull,
  },
  detailName: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  detailNameDark: {
    color: darkColors.textPrimary,
  },
  detailStat: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  detailStatDark: {
    color: darkColors.textSecondary,
  },
  detailExList: {
    maxHeight: 120,
    width: '100%',
  },
  detailExItem: {
    marginBottom: spacing.xs,
    width: '100%',
  },
  detailExNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    width: '100%',
  },
  detailExDot: {
    width: 5,
    height: 5,
    borderRadius: layout.borderRadiusFull,
    flexShrink: 0,
  },
  detailExName: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  detailExNameDark: {
    color: darkColors.textPrimary,
  },
  detailExSub: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    paddingLeft: spacing.sm,
  },
  detailExSubDark: {
    color: darkColors.textSecondary,
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 100,
  },
  infoOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    zIndex: 5,
  },
  activityName: {
    ...typography.statsValue,
    color: colors.textOnDark,
    textShadowColor: colorWithOpacity(ink.black, 0.6),
    ...mapTextShadow,
  },
  activityNameLight: {
    color: colors.textPrimary,
    textShadowColor: 'transparent',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  activityDate: {
    fontSize: typography.bodyCompact.fontSize,
    color: colorWithOpacity(ink.white, 0.85),
  },
  activityDateLight: {
    color: colors.textSecondary,
  },
  durationStat: {
    ...typography.bodyCompact,
    fontWeight: '600',
    color: colors.textOnDark,
    textShadowColor: colorWithOpacity(ink.black, 0.5),
    ...mapTextShadow,
  },
  durationStatLight: {
    color: colors.textPrimary,
    textShadowColor: 'transparent',
  },
});
