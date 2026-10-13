import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
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
import {
  composeAccessibilityLabel,
  EmptyState,
  ErrorState,
  Row,
  ScreenScrollView,
} from '@/shared/ui';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import type { ExerciseDetailData } from 'veloqrs';

import { readExerciseDetailData } from '../hooks/useStrengthScreenData';
import { formatBestSet } from '../lib/formatting';
import { tapTo } from '@/shared/app/navigation';

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
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { data, isLoading, isError, error, refetch } = useQuery({
    ...LOCAL_READ_QUERY,
    queryKey: [...queryKeys.strength.exerciseDetail(exerciseCategory), readGeneration],
    queryFn: () => readExerciseDetailData(exerciseCategory),
    enabled: Number.isInteger(exerciseCategory) && exerciseCategory >= 0,
  });
  const sessions = data?.sessions ?? [];

  return (
    <ScreenScrollView
      style={[styles.screen, isDark && styles.screenDark]}
      contentContainerStyle={styles.content}
    >
      <Text variant="headlineSmall" style={[styles.title, isDark && styles.textDark]}>
        {data?.exerciseName || t('strength.history')}
      </Text>
      {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {isError ? (
        <ErrorState
          error={error}
          fallbackKey="strength.exerciseActivitiesFailed"
          onRetry={() => void refetch()}
          testID="exercise-detail-failure"
        />
      ) : null}
      {!isLoading && !isError && sessions.length === 0 ? (
        <EmptyState
          variant="compact"
          icon="dumbbell"
          title={t('strength.exerciseActivitiesEmpty')}
        />
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
          {[...sessions].reverse().map((session) => {
            const title = `${formatEpochDayUtc(session.date)} · ${session.activityName}`;
            const bestSet = `${t('strength.bestSet')}: ${formatBestSet(session.bestSet, isMetric, t)}`;
            const estimate = `${t('strength.estimatedOneRepMax')}: ${
              session.estimatedOneRepMaxKg == null
                ? t('strength.noEstimate')
                : formatWeight(session.estimatedOneRepMaxKg, isMetric)
            }`;
            return (
              <View key={session.activityId} style={[styles.row, isDark && styles.rowDark]}>
                <Row
                  behaviour="navigate"
                  onPress={() => tapTo(`/activity/${session.activityId}`)}
                  accessibilityLabel={composeAccessibilityLabel(title, bestSet, estimate)}
                >
                  <View style={styles.session}>
                    <Text style={[styles.sessionTitle, isDark && styles.textDark]}>{title}</Text>
                    <Text style={isDark && styles.textDark}>{bestSet}</Text>
                    <Text style={[styles.method, isDark && styles.secondaryDark]}>{estimate}</Text>
                  </View>
                </Row>
              </View>
            );
          })}
        </>
      ) : null}
    </ScreenScrollView>
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
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
  },
  session: { flex: 1, gap: spacing.xs },
  sessionTitle: { fontWeight: '600', color: colors.textPrimary },
  rowDark: { backgroundColor: darkColors.surface },
});
