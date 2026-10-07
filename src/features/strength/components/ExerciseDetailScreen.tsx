import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { useTheme, useMetricSystem } from '@/shared/app';
import { formatEpochDayUtc } from '@/shared/format/format';
import { formatWeight } from '@/shared/format/weight';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import { queryKeys } from '@/shared/query/queryKeys';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { Button } from '@/shared/ui';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import type { ExerciseDetailData } from 'veloqrs';

import { readExerciseDetailData } from '../hooks/useStrengthScreenData';

function Trend({ sessions }: { sessions: ExerciseDetailData['sessions'] }) {
  const points = sessions
    .filter((session) => session.estimatedOneRepMaxKg != null)
    .map((session) => session.estimatedOneRepMaxKg as number);
  if (points.length < 2) return null;
  const minimum = Math.min(...points);
  const maximum = Math.max(...points);
  const range = Math.max(maximum - minimum, 1);
  const coords = points.map((value, index) => ({
    x: 12 + (296 * index) / (points.length - 1),
    y: 100 - ((value - minimum) / range) * 80,
  }));
  return (
    <Svg width="100%" height={120} viewBox="0 0 320 120" accessibilityRole="image">
      <Polyline
        points={coords.map(({ x, y }) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={colors.primary}
        strokeWidth={3}
      />
      {coords.map(({ x, y }, index) => (
        <Circle key={index} cx={x} cy={y} r={4} fill={colors.primary} />
      ))}
    </Svg>
  );
}

function ExerciseDetailScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const exerciseCategory = Number(category);
  const readGeneration = useEngineSubscription(['activities', 'fitParsed']);
  const router = useRouter();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { data, isLoading, isError } = useQuery({
    ...LOCAL_READ_QUERY,
    queryKey: [...queryKeys.strength.exerciseDetail(exerciseCategory), readGeneration],
    queryFn: () => readExerciseDetailData(exerciseCategory),
    enabled: Number.isInteger(exerciseCategory) && exerciseCategory >= 0,
  });
  const sessions = data?.sessions ?? [];

  return (
    <ScrollView
      style={[styles.screen, isDark && styles.screenDark]}
      contentContainerStyle={styles.content}
    >
      <Text variant="headlineSmall" style={[styles.title, isDark && styles.textDark]}>
        {data?.exerciseName || t('strength.history')}
      </Text>
      {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {isError ? <Text>{t('strength.exerciseActivitiesFailed')}</Text> : null}
      {!isLoading && !isError && sessions.length === 0 ? (
        <Text style={isDark && styles.textDark}>{t('strength.exerciseActivitiesEmpty')}</Text>
      ) : null}
      {sessions.length > 0 ? (
        <>
          <Text style={[styles.section, isDark && styles.textDark]}>
            {t('strength.estimatedOneRepMax')}
          </Text>
          <Trend sessions={sessions} />
          <Text style={[styles.method, isDark && styles.secondaryDark]}>
            {t('strength.epleyMethod')}
          </Text>
          {[...sessions].reverse().map((session) => (
            <View key={session.activityId} style={[styles.row, isDark && styles.rowDark]}>
              <Button
                label={`${formatEpochDayUtc(session.date)} · ${session.activityName}`}
                variant="ghost"
                onPress={() => router.push(`/activity/${session.activityId}`)}
              />
              <Text style={isDark && styles.textDark}>
                {t('strength.bestSet')}: {formatWeight(session.bestSet.weightKg ?? 0, isMetric)} ·{' '}
                {session.bestSet.repetitions ?? '--'} {t('strength.reps')}
              </Text>
              <Text style={[styles.method, isDark && styles.secondaryDark]}>
                {t('strength.estimatedOneRepMax')}:{' '}
                {session.estimatedOneRepMaxKg == null
                  ? t('strength.noEstimate')
                  : formatWeight(session.estimatedOneRepMaxKg, isMetric)}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

export default withScreenBoundary(ExerciseDetailScreen, 'ExerciseDetail');

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenDark: { backgroundColor: darkColors.background },
  content: { padding: spacing.md, gap: spacing.sm },
  title: { color: colors.textPrimary },
  section: { fontSize: typography.body.fontSize, fontWeight: '600', color: colors.textPrimary },
  method: { color: colors.textSecondary },
  secondaryDark: { color: darkColors.textSecondary },
  textDark: { color: darkColors.textPrimary },
  row: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    gap: spacing.xs,
  },
  rowDark: { backgroundColor: darkColors.surface },
});
