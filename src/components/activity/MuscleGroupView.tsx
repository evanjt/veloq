import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMuscleGroups } from '@/hooks/activities';
import { useMuscleDetail } from '@/hooks/activities/useMuscleDetail';
import { TappableBody } from './TappableBody';
import { MuscleDetailSheet } from './MuscleDetailSheet';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatDuration } from '@/lib';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { ActivityDetail } from '@/types';
import type { ExerciseSet } from 'veloqrs';

interface MuscleGroupViewProps {
  activityId: string;
  activity: ActivityDetail;
  hasExercises: boolean;
  isDark: boolean;
  athleteSex?: string;
  exerciseSets?: ExerciseSet[];
}

const PRIMARY_COLOR = '#FC4C02';
const SECONDARY_COLOR = '#FCA67A';

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
  const { data: muscleGroups } = useMuscleGroups(activityId, hasExercises);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const muscleDetail = useMuscleDetail(selectedMuscle, exerciseSets ?? []);

  const handleMuscleTap = useCallback(
    (slug: string) => {
      if ((exerciseSets ?? []).length > 0) {
        setSelectedMuscle(slug);
      }
    },
    [exerciseSets]
  );

  const handleCloseSheet = useCallback(() => {
    setSelectedMuscle(null);
  }, []);

  const bodyData: ExtendedBodyPart[] = (muscleGroups ?? []).map((g) => ({
    slug: g.slug as ExtendedBodyPart['slug'],
    intensity: g.intensity,
  }));

  const tappableSlugs = useMemo(
    () => new Set((muscleGroups ?? []).map((g) => g.slug)),
    [muscleGroups]
  );

  const gender = athleteSex === 'F' ? 'female' : 'male';
  const hasInteractiveData = (exerciseSets ?? []).length > 0 && tappableSlugs.size > 0;

  return (
    <View style={[styles.hero, isDark && styles.heroDark]}>
      {/* Back button */}
      <View style={[styles.floatingHeader, { paddingTop: insets.top }]} pointerEvents="box-none">
        <TouchableOpacity
          testID="activity-detail-back"
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={isDark ? colors.textOnDark : colors.textPrimary}
          />
        </TouchableOpacity>
      </View>

      {/* Body diagrams with legend between */}
      <View style={[styles.bodyContainer, { paddingTop: insets.top + 40 }]}>
        <View style={styles.bodyView}>
          <TappableBody
            data={bodyData}
            gender={gender}
            side="front"
            scale={0.7}
            colors={[SECONDARY_COLOR, PRIMARY_COLOR]}
            onMuscleTap={hasInteractiveData ? handleMuscleTap : undefined}
            tappableSlugs={tappableSlugs}
          />
        </View>
        <View style={styles.legendCenter}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: PRIMARY_COLOR }]} />
            <Text style={styles.legendText}>{t('activityDetail.primary')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: SECONDARY_COLOR }]} />
            <Text style={styles.legendText}>{t('activityDetail.secondary')}</Text>
          </View>
          {hasInteractiveData && (
            <Text style={styles.hintText}>{t('activityDetail.tapMuscle', 'Tap for details')}</Text>
          )}
        </View>
        <View style={styles.bodyView}>
          <TappableBody
            data={bodyData}
            gender={gender}
            side="back"
            scale={0.7}
            colors={[SECONDARY_COLOR, PRIMARY_COLOR]}
            onMuscleTap={hasInteractiveData ? handleMuscleTap : undefined}
            tappableSlugs={tappableSlugs}
          />
        </View>
      </View>

      {/* Bottom gradient + activity info overlay (like map hero) */}
      <LinearGradient
        colors={isDark ? ['transparent', 'rgba(0,0,0,0.7)'] : ['transparent', 'rgba(0,0,0,0.15)']}
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

      <MuscleDetailSheet
        detail={muscleDetail}
        visible={selectedMuscle !== null && muscleDetail !== null}
        onClose={handleCloseSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    position: 'relative',
    backgroundColor: '#F0F0F0',
  },
  heroDark: {
    backgroundColor: '#111',
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(128,128,128,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bodyContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xl + spacing.lg,
  },
  bodyView: {
    flex: 1,
    alignItems: 'center',
  },
  legendCenter: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  hintText: {
    fontSize: 9,
    color: colors.textDisabled,
    marginTop: spacing.xs,
    fontStyle: 'italic',
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
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    color: 'rgba(255,255,255,0.85)',
  },
  activityDateLight: {
    color: colors.textSecondary,
  },
  durationStat: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textOnDark,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  durationStatLight: {
    color: colors.textPrimary,
    textShadowColor: 'transparent',
  },
});
