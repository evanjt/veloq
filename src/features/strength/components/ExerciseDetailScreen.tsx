import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useTheme, useMetricSystem } from '@/shared/app';
import { sportMarkColour } from '@/shared/activity/sportCategories';
import { formatEpochDayUtc } from '@/shared/format/format';
import { formatWeight } from '@/shared/format/weight';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import { queryKeys } from '@/shared/query/queryKeys';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import {
  composeAccessibilityLabel,
  Card,
  EmptyState,
  ErrorState,
  Row,
  ScreenScrollView,
  Spinner,
} from '@/shared/ui';
import { InsightSeriesChart } from '@/features/insights';
import { colors, darkColors, spacing, typography } from '@/theme';

import { readExerciseDetailData } from '../hooks/useStrengthScreenData';
import { exerciseTrendSamples } from '../lib/exerciseTrend';
import { formatBestSet } from '../lib/formatting';
import { navigateTo } from '@/shared/app/navigation';

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
  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const trend = useMemo(() => exerciseTrendSamples(sessions), [sessions]);
  const formatEstimate = useCallback((value: number) => formatWeight(value, isMetric), [isMetric]);
  const trendColor = sportMarkColour('WeightTraining', isDark);

  return (
    <ScreenScrollView
      style={[styles.screen, isDark && styles.screenDark]}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: data?.exerciseName || t('strength.history') }} />
      {isLoading ? <Spinner label={t('common.loading')} /> : null}
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
          <InsightSeriesChart
            samples={trend}
            title={t('strength.estimatedOneRepMax')}
            color={trendColor}
            pointColor={trendColor}
            formatValue={formatEstimate}
            area={false}
          />
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
              <Card key={session.activityId} variant="flat" padding="none">
                <Row
                  behaviour="navigate"
                  onPress={() => navigateTo(`/activity/${session.activityId}`)}
                  accessibilityLabel={composeAccessibilityLabel(title, bestSet, estimate)}
                >
                  <View style={styles.session}>
                    <Text style={[styles.sessionTitle, isDark && styles.textDark]}>{title}</Text>
                    <Text style={isDark ? styles.textDark : null}>{bestSet}</Text>
                    <Text style={[styles.method, isDark && styles.secondaryDark]}>{estimate}</Text>
                  </View>
                </Row>
              </Card>
            );
          })}
        </>
      ) : null}
    </ScreenScrollView>
  );
}

export default withScreenBoundary(ExerciseDetailScreen, 'ExerciseDetail');

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  screenDark: { backgroundColor: darkColors.surfacePage },
  content: { padding: spacing.md, gap: spacing.sm },
  method: { color: colors.textSecondary },
  secondaryDark: { color: darkColors.textSecondary },
  textDark: { color: darkColors.textPrimary },
  session: { flex: 1, gap: spacing.xs },
  sessionTitle: { ...typography.bodySmallBold, color: colors.textPrimary },
});
