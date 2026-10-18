import React, { useState, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useTranslation } from 'react-i18next';
import type { ActivityRecord, ExerciseSet } from 'veloqrs';

import { useMetricSystem } from '@/shared/app';
import { formatDateTime, formatDuration } from '@/shared/format/format';
import {
  bodyDiagram,
  colors,
  colorWithOpacity,
  iconSize,
  ink,
  layers,
  layout,
  mapTextShadow,
  opacity,
  spacing,
  themedStyles,
  type Palette,
  typography,
} from '@/theme';

import { useMuscleGroups } from '../hooks/useExerciseSets';
import { useMuscleDetail } from '../hooks/useMuscleDetail';
import { formatWeight } from '@/shared/format/weight';
import { BodyPairWithLoupe } from './BodyPairWithLoupe';
import { IconButton, useHeroHeaderBottom } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { RowDivider } from '@/shared/ui/RowGroup';
import { ErrorState } from '@/shared/ui/ErrorState';
import { NameText } from '@/shared/ui/NameText';

interface MuscleGroupViewProps {
  activityId: string;
  activity: ActivityRecord;
  hasExercises: boolean;
  isDark: boolean;
  athleteSex?: string | undefined;
  exerciseSets?: ExerciseSet[];
}

// A primary muscle is drawn at the top sequential step and an assisting one at the
// middle step, the same scale the strength body diagram shades volume on.
function muscleRoleColours(isDark: boolean) {
  const steps = bodyDiagram[isDark ? 'dark' : 'light'].steps;
  const primary = steps[4];
  const secondary = steps[2];
  return { primary, secondary, body: [secondary, primary] as const };
}

export function MuscleGroupView({
  activityId,
  activity,
  hasExercises,
  isDark,
  athleteSex,
  exerciseSets,
}: MuscleGroupViewProps) {
  const { t } = useTranslation();
  const styles = themedStyles(makeStyles, isDark);
  const roleColours = muscleRoleColours(isDark);
  const headerBottom = useHeroHeaderBottom();
  const isMetric = useMetricSystem();
  const {
    data: muscleGroups,
    error: muscleGroupsError,
    refetch: refetchMuscleGroups,
  } = useMuscleGroups(activityId, hasExercises);
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
    <View style={styles.hero}>
      <Stack.Screen
        options={{ headerTintColor: isDark ? colors.textOnFill : colors.textPrimary }}
      />

      {/* Body diagrams with unified loupe + center column */}
      <View style={[styles.bodyContainer, { paddingTop: headerBottom }]}>
        <BodyPairWithLoupe
          data={bodyData}
          selectedSlug={selectedMuscle}
          gender={gender}
          maxScale={0.65}
          colors={roleColours.body}
          onMuscleTap={hasInteractiveData ? handleMuscleTap : undefined}
          onMuscleScrub={hasInteractiveData ? handleMuscleScrub : undefined}
          tappableSlugs={tappableSlugs}
          accessibilityLabel={t('strength.muscleGroupVolume')}
          accessibilityValueText={
            muscleDetail
              ? `${muscleDetail.name}, ${t('activity.muscle.setCount', { count: muscleDetail.totalSets })}, ${t('activity.muscle.repsCount', { count: muscleDetail.totalReps })}`
              : undefined
          }
          centerWidth={CENTER_COLUMN_WIDTH}
          centerContent={
            <View style={styles.centerColumn}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: roleColours.primary }]} />
                <Text style={styles.legendText}>{t('activityDetail.primary')}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: roleColours.secondary }]} />
                <Text style={styles.legendText}>{t('activityDetail.secondary')}</Text>
              </View>

              {muscleGroupsError ? (
                <ErrorState
                  variant="inline"
                  error={muscleGroupsError}
                  onRetry={() => void refetchMuscleGroups()}
                  testID="muscle-groups-failure"
                />
              ) : null}

              {muscleDetail ? (
                <>
                  <View style={styles.detailDividerGap}>
                    <RowDivider inset="none" />
                  </View>
                  <View style={styles.detailHeaderRow}>
                    <View
                      style={[
                        styles.detailDot,
                        {
                          backgroundColor:
                            muscleDetail.primaryExercises > 0
                              ? roleColours.primary
                              : roleColours.secondary,
                        },
                      ]}
                    />
                    <Text style={styles.detailName}>{muscleDetail.name}</Text>
                    <IconButton
                      accessibilityLabel={t('common.close', 'Close')}
                      onPress={() => setSelectedMuscle(null)}
                    >
                      <Icon name="close" size={iconSize.xs} color={styles.detailStat.color} />
                    </IconButton>
                  </View>
                  <Text style={styles.detailStat}>
                    {t('activity.muscle.setCount', {
                      count: muscleDetail.totalSets,
                    })}{' '}
                    ·{' '}
                    {t('activity.muscle.repsCount', {
                      count: muscleDetail.totalReps,
                    })}
                  </Text>
                  {muscleDetail.volumeKg > 0 && (
                    <Text style={styles.detailStat}>
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
                                  ex.role === 'primary'
                                    ? roleColours.primary
                                    : roleColours.secondary,
                              },
                            ]}
                          />
                          <NameText style={styles.detailExName}>{ex.name}</NameText>
                        </View>
                        <Text style={styles.detailExSub}>
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
        colors={['transparent', colorWithOpacity(ink.black, isDark ? opacity.pressed : 0.15)]}
        style={styles.gradient}
        pointerEvents="none"
      />
      <View style={styles.infoOverlay} pointerEvents="none">
        <NameText
          accessibilityRole="header"
          style={[styles.activityName, !isDark && styles.activityNameLight]}
        >
          {activity.name}
        </NameText>
        <View style={styles.metaRow}>
          <Text style={[styles.activityDate, !isDark && styles.activityDateLight]}>
            {activity.startDateLocal ? formatDateTime(activity.startDateLocal) : null}
          </Text>
          <Text
            accessibilityLabel={`${t('activity.duration')}: ${formatDuration(activity.movingTime)}`}
            style={[styles.durationStat, !isDark && styles.durationStatLight]}
          >
            {formatDuration(activity.movingTime)}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** The legend between the two figures. */
const CENTER_COLUMN_WIDTH = 120;

const MUSCLE_VIEW_BOTTOM_PADDING = spacing.xl + spacing.lg;

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    hero: {
      position: 'relative',
      backgroundColor: palette.surfaceRaised,
    },
    bodyContainer: {
      paddingHorizontal: spacing.sm,
      paddingBottom: MUSCLE_VIEW_BOTTOM_PADDING,
    },
    centerColumn: {
      width: CENTER_COLUMN_WIDTH,
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
      ...typography.micro,
      color: palette.textSecondary,
    },
    hintText: {
      fontSize: typography.pillLabel.fontSize,
      color: palette.textSecondary,
      marginTop: spacing.xs,
    },
    detailDividerGap: {
      paddingVertical: spacing.xs,
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
      ...typography.bodyCompactBold,
      color: palette.textPrimary,
    },
    detailStat: {
      fontSize: typography.label.fontSize,
      color: palette.textSecondary,
      lineHeight: 16,
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
      ...typography.badge,
      color: palette.textPrimary,
      flexShrink: 1,
    },
    detailExSub: {
      ...typography.micro,
      color: palette.textSecondary,
      paddingLeft: spacing.sm,
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
      zIndex: layers.raised,
    },
    activityName: {
      ...typography.statsValue,
      color: colors.textOnFill,
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
      ...typography.bodyCompact,
      color: colors.textOnFill,
    },
    activityDateLight: {
      color: palette.textSecondary,
    },
    durationStat: {
      ...typography.bodyCompactBold,
      color: colors.textOnFill,
      textShadowColor: colorWithOpacity(ink.black, opacity.disabled),
      ...mapTextShadow,
    },
    durationStatLight: {
      color: colors.textPrimary,
      textShadowColor: 'transparent',
    },
  });
