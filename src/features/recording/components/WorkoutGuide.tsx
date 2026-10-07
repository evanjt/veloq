import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { formatDistance, formatDuration } from '@/shared/format/format';
import { layout, spacing, typography } from '@/theme';
import { useWorkoutView } from '@/features/recording/hooks/useWorkoutView';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import {
  formatLineDuration,
  formatTarget,
  type PlanLine,
} from '@/features/recording/lib/planFollow';

interface WorkoutGuideProps {
  isMetric: boolean;
  isLocked: boolean;
  textPrimary: string;
  textSecondary: string;
  surface: string;
  border: string;
  accent: string;
}

function lineTargets(line: PlanLine): string {
  return (line.targets ?? []).map(formatTarget).join(' · ');
}

function lineSummary(line: PlanLine, isMetric: boolean): string {
  const amount =
    line.distanceMetres != null
      ? formatDistance(line.distanceMetres, isMetric)
      : line.durationSeconds != null
        ? formatLineDuration(line.durationSeconds)
        : null;
  return [amount, lineTargets(line)].filter(Boolean).join('  ');
}

/**
 * The planned workout a ride or run follows: the current step and its target
 * over the ordered list, above the map or indoor display. It reads the plan
 * and its progress from the recording store and forwards the athlete's Next,
 * so a pause freezes it with the moving clock and the step it shows is the
 * one the store moves on from.
 */
function WorkoutGuideInner({
  isMetric,
  isLocked,
  textPrimary,
  textSecondary,
  surface,
  border,
  accent,
}: WorkoutGuideProps) {
  const { t } = useTranslation();
  const view = useWorkoutView();
  const next = useCallback(() => useRecordingStore.getState().advanceWorkout(), []);
  if (!view) return null;

  const { follow } = view;
  const finished = follow.finishedAt != null;
  const line = follow.lines[follow.index];
  const target = line ? lineTargets(line) : '';

  return (
    <View
      style={[styles.card, { backgroundColor: surface, borderColor: border }]}
      testID="workout-guide"
    >
      {finished ? (
        <Text testID="workout-complete" style={[styles.title, { color: textPrimary }]}>
          {t('recording.workoutComplete', 'Plan complete')}
        </Text>
      ) : (
        <>
          <View style={styles.header}>
            <Text style={[styles.caption, { color: textSecondary }]}>
              {t('recording.workoutStep', 'Step {{n}} of {{total}}', {
                n: follow.index + 1,
                total: follow.lines.length,
              })}
            </Text>
            {view.remainingSeconds != null && (
              <Text testID="workout-countdown" style={[styles.amount, { color: accent }]}>
                {formatDuration(view.remainingSeconds)}
              </Text>
            )}
            {view.remainingMetres != null && (
              <Text testID="workout-distance" style={[styles.amount, { color: accent }]}>
                {formatDistance(view.remainingMetres, isMetric)}
              </Text>
            )}
          </View>
          <Text testID="workout-current-step" style={[styles.title, { color: textPrimary }]}>
            {line ? line.text || lineSummary(line, isMetric) : ''}
          </Text>
          {target !== '' && (
            <Text testID="workout-current-target" style={[styles.target, { color: accent }]}>
              {target}
            </Text>
          )}
        </>
      )}
      <ScrollView style={styles.list} testID="workout-step-list" nestedScrollEnabled>
        {follow.lines.map((l, i) => (
          <Text
            key={i}
            style={[
              styles.row,
              {
                color: i === follow.index && !finished ? textPrimary : textSecondary,
                opacity: i < follow.index || finished ? 0.5 : 1,
              },
            ]}
          >
            {`${i + 1}. ${[l.text, lineSummary(l, isMetric)].filter(Boolean).join('  ')}`}
          </Text>
        ))}
      </ScrollView>
      {!finished && (
        <Button
          testID="workout-next"
          size="sm"
          variant="secondary"
          label={t('recording.workoutNext', 'Next step')}
          onPress={next}
          disabled={isLocked}
        />
      )}
    </View>
  );
}

export const WorkoutGuide = React.memo(WorkoutGuideInner);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    gap: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  caption: {
    ...typography.caption,
  },
  amount: {
    ...typography.statsValue,
  },
  title: {
    ...typography.cardTitle,
  },
  target: {
    ...typography.bodyBold,
  },
  list: {
    maxHeight: spacing.xxl * 2,
  },
  row: {
    ...typography.bodySmall,
    paddingVertical: spacing.xxs,
  },
});
