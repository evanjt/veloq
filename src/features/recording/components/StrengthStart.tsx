import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import {
  strength,
  type StrengthStart as StrengthStartKind,
  type StrengthStartGroup,
} from 'veloqrs';

import { useAthlete, useTheme } from '@/shared/app';
import { StrengthCardBodies } from '@/features/strength';
import { Button } from '@/shared/ui/Button';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { Card } from '@/shared/ui/Card';
import { SectionTitle } from '@/shared/ui/SectionTitle';
import { useBottomClearance } from '@/shared/ui/tabBarClearance';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';

const BODY_SCALE = 0.2;

const EQUIPMENT_ICON: Record<string, IconName> = {
  barbell: 'weight-lifter',
  dumbbell: 'dumbbell',
  kettlebell: 'kettlebell',
  cable: 'cable-data',
  machine: 'cog',
  band: 'lasso',
  bodyweight: 'human-handsup',
  other: 'dots-horizontal',
};

interface StrengthStartProps {
  start: (from: StrengthStartKind) => unknown;
  refused: boolean;
  /** Today's planned workout for this recording, when it has lines to start from. */
  plan?: { name: string; lines: string[]; start: (lines: string[]) => unknown } | null;
}

function GroupCard({
  group,
  index,
  gender,
  onPress,
}: {
  group: StrengthStartGroup;
  index: number;
  gender: 'male' | 'female';
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const names = group.exerciseNames.join(', ');
  const muscles = useMemo(
    () =>
      group.muscles.map((muscle): ExtendedBodyPart => ({
        slug: muscle.slug as NonNullable<ExtendedBodyPart['slug']>,
        intensity: muscle.intensity,
      })),
    [group.muscles]
  );
  return (
    <Card
      variant="flat"
      padding="sm"
      testID={`strength-start-group-${index}`}
      accessibilityRole="button"
      accessibilityLabel={t('strength.recorder.startFrom', { name: names })}
      onPress={onPress}
      style={styles.card}
    >
      <StrengthCardBodies muscles={muscles} gender={gender} scale={BODY_SCALE} />
      <View style={styles.cardText}>
        <Text style={[styles.names, { color: palette.textPrimary }]}>{names}</Text>
        <View style={styles.meta}>
          {group.equipment.map((kind) => (
            <Icon
              key={kind}
              name={EQUIPMENT_ICON[kind] ?? 'dots-horizontal'}
              size={iconSize.sm}
              color={palette.textSecondary}
            />
          ))}
          <Text style={[styles.caption, { color: palette.textSecondary }]}>
            {t('strength.picker.daysAgo', { count: group.lastDoneDays })}
          </Text>
          <Text style={[styles.caption, { color: palette.textSecondary }]}>
            {t('strength.recorder.groupTimes', { count: group.times })}
          </Text>
        </View>
      </View>
    </Card>
  );
}

/**
 * Where a strength session begins: the sessions the athlete has done the same way before, the
 * saved workouts and an empty start. What each offers is the engine's read of the library; a tap
 * starts the session from that source and the engine prepares it.
 */
export function StrengthStart({ start, refused, plan }: StrengthStartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const bottomClearance = useBottomClearance();
  const { data: athlete } = useAthlete();
  const gender = athlete?.sex === 'F' ? 'female' : 'male';
  const [data] = useState(() => strength.getStrengthStartData(Date.now() / 1000));

  return (
    <ScrollView
      testID="strength-start"
      style={{ backgroundColor: palette.surfacePage }}
      contentContainerStyle={[styles.content, { paddingBottom: bottomClearance + spacing.md }]}
    >
      {plan ? (
        <Button
          testID="strength-start-plan"
          label={t('strength.recorder.startFrom', { name: plan.name })}
          onPress={() => plan.start(plan.lines)}
        />
      ) : null}
      <Button
        testID="strength-start-blank"
        label={t('strength.recorder.startEmpty')}
        onPress={() => start({ kind: 'Blank' })}
      />
      {refused ? (
        <Text style={[styles.caption, { color: palette.textSecondary }]}>
          {t('strength.recorder.refused')}
        </Text>
      ) : null}

      <SectionTitle style={styles.heading}>{t('strength.recorder.previousSessions')}</SectionTitle>
      {data.groups.length === 0 ? (
        <Text style={[styles.caption, { color: palette.textSecondary }]}>
          {t('strength.recorder.noHistory')}
        </Text>
      ) : (
        data.groups.map((group, index) => (
          <GroupCard
            key={group.signature}
            group={group}
            index={index}
            gender={gender}
            onPress={() => start({ kind: 'Activity', id: group.latestActivityId })}
          />
        ))
      )}

      {data.workouts.length > 0 ? (
        <>
          <SectionTitle style={styles.heading}>{t('strength.recorder.savedWorkouts')}</SectionTitle>
          {data.workouts.map((workout, index) => (
            <Card
              key={workout.id}
              variant="flat"
              padding="sm"
              testID={`strength-start-workout-${index}`}
              accessibilityRole="button"
              accessibilityLabel={t('strength.recorder.startFrom', { name: workout.name })}
              onPress={() => start({ kind: 'Workout', id: workout.id })}
              style={styles.card}
            >
              <View style={styles.cardText}>
                <Text style={[styles.names, { color: palette.textPrimary }]}>{workout.name}</Text>
                <Text style={[styles.caption, { color: palette.textSecondary }]}>
                  {t('strength.recorder.workoutSummary', {
                    exercises: workout.exerciseCount,
                    sets: workout.setCount,
                  })}
                </Text>
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.sm },
  heading: { marginTop: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardText: { flex: 1, gap: spacing.xs },
  names: { ...typography.bodyCompactBold },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  caption: { ...typography.caption },
});
