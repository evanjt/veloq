import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import type { LiveStrengthEdit, LiveStrengthExercise, WeightUnit } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Icon } from '@/shared/ui/Icon';
import { IconButton } from '@/shared/ui/IconButton';
import { useGestureCallback } from '@/shared/ui/useGestureCallback';
import { colors, darkColors, iconSize, layers, layout, spacing, stroke, typography } from '@/theme';

import { StrengthSetRow } from './StrengthSetRow';
import { StrengthStepper } from './StrengthStepper';

/** One tap of a rest stepper, in seconds. */
export const REST_STEP_SECS = 30;

/** The rest after a tap of a rest stepper: undefined once it falls to nothing. */
export function steppedRest(current: number | undefined, direction: 1 | -1): number | undefined {
  const next = Math.max(0, (current ?? 0) + direction * REST_STEP_SECS);
  return next === 0 ? undefined : next;
}

interface RestControlProps {
  testID: string;
  label: string;
  secs: number | undefined;
  onChange: (secs: number | undefined) => void;
}

/** A rest per exercise or group, stepped in thirty seconds. */
export function StrengthRestControl({ testID, label, secs, onChange }: RestControlProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  return (
    <View style={styles.rest}>
      <Text style={[styles.restLabel, { color: palette.textSecondary }]}>{label}</Text>
      <StrengthStepper
        testID={testID}
        label={label}
        incrementLabel={t('strength.recorder.increase', { what: label })}
        decrementLabel={t('strength.recorder.decrease', { what: label })}
        reading={
          secs == null
            ? t('strength.recorder.restNone')
            : t('strength.recorder.restSeconds', { count: secs })
        }
        onStep={(direction) => onChange(steppedRest(secs, direction))}
      />
    </View>
  );
}

interface StrengthExerciseCardProps {
  index: number;
  exercise: LiveStrengthExercise;
  /** The unit the athlete reads and enters weight in. */
  weightUnit: WeightUnit;
  /** The set the session is at, when it is in this exercise. */
  currentSet: number | undefined;
  /** Whether an exercise sits above and below, for the handle's move actions. */
  hasPrevious: boolean;
  hasNext: boolean;
  edit: (change: LiveStrengthEdit) => void;
  toggleDone: (set: number) => void;
  /** The handle was let go after being dragged this far down (negative: up), in points. */
  onDrop: (translationY: number) => void;
}

/**
 * An exercise with its sets, its rest and a drag handle. The handle drags the card: let go over the
 * middle of another card to group the two, over an edge to move. It also carries the same moves as
 * accessibility actions, since a drag is not available to everyone.
 */
export function StrengthExerciseCard({
  index,
  exercise,
  weightUnit,
  currentSet,
  hasPrevious,
  hasNext,
  edit,
  toggleDone,
  onDrop,
}: StrengthExerciseCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const id = `strength-exercise-${index}`;
  const dragY = useSharedValue(0);
  const dropOnJS = useGestureCallback(onDrop);

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(`${id}-drag`)
        .onUpdate((event) => {
          dragY.value = event.translationY;
        })
        .onEnd((event) => {
          dragY.value = 0;
          runOnJS(dropOnJS)(event.translationY);
        })
        .onFinalize(() => {
          dragY.value = 0;
        }),
    [id, dragY, dropOnJS]
  );
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
    zIndex: dragY.value === 0 ? layers.base : layers.raised,
  }));

  const actions = [
    ...(hasPrevious ? [{ name: 'moveUp', label: t('strength.recorder.moveUp') }] : []),
    ...(hasNext ? [{ name: 'moveDown', label: t('strength.recorder.moveDown') }] : []),
    ...(hasPrevious
      ? [{ name: 'groupWithPrevious', label: t('strength.recorder.groupWithPrevious') }]
      : []),
    ...(exercise.groupNo != null
      ? [{ name: 'ungroup', label: t('strength.recorder.ungroup') }]
      : []),
  ];
  const onAction = (name: string) => {
    if (name === 'moveUp') edit({ kind: 'MoveExercise', exercise: index, to: index - 1 });
    else if (name === 'moveDown') edit({ kind: 'MoveExercise', exercise: index, to: index + 1 });
    else if (name === 'groupWithPrevious') edit({ kind: 'Group', exercise: index, to: index - 1 });
    else if (name === 'ungroup') edit({ kind: 'Ungroup', exercise: index });
  };

  return (
    <Animated.View
      testID={id}
      style={[
        exercise.groupNo != null && {
          borderLeftWidth: stroke.three,
          borderLeftColor: palette.actionPrimary,
        },
        lift,
      ]}
    >
      <Card variant="flat" padding="sm" style={{ gap: spacing.xs }}>
        <View style={styles.header}>
          <GestureDetector gesture={drag}>
            <View
              testID={`${id}-handle`}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={t('strength.recorder.dragHandle')}
              accessibilityActions={actions}
              onAccessibilityAction={(event) => onAction(event.nativeEvent.actionName)}
              style={styles.handle}
            >
              <Icon name="drag" size={iconSize.md} color={palette.textSecondary} />
            </View>
          </GestureDetector>
          <View style={styles.title}>
            <Text style={[styles.name, { color: palette.textPrimary }]}>
              {exercise.displayName}
            </Text>
          </View>
          <IconButton
            testID={`${id}-remove`}
            compact
            variant="ghost"
            accessibilityLabel={t('strength.recorder.removeExercise')}
            onPress={() => edit({ kind: 'RemoveExercise', exercise: index })}
          >
            <Icon name="close" size={iconSize.sm} color={palette.textSecondary} />
          </IconButton>
        </View>

        {exercise.sets.length === 0 ? (
          <Text style={[styles.empty, { color: palette.textSecondary }]}>
            {t('strength.recorder.noSets')}
          </Text>
        ) : null}
        {exercise.sets.map((set, setIndex) => (
          <StrengthSetRow
            // A set has no id of its own; its place is its identity.
            key={setIndex}
            exerciseIndex={index}
            setIndex={setIndex}
            exercise={exercise}
            set={set}
            weightUnit={weightUnit}
            current={currentSet === setIndex}
            edit={edit}
            toggleDone={() => toggleDone(setIndex)}
          />
        ))}
        {exercise.sets.length === 0 ? (
          <Button
            testID={`${id}-add-set`}
            size="sm"
            variant="secondary"
            label={t('strength.recorder.addFirstSet')}
            onPress={() => edit({ kind: 'AddSet', exercise: index })}
          />
        ) : null}

        {exercise.groupNo == null ? (
          <StrengthRestControl
            testID={`${id}-rest`}
            label={t('strength.recorder.rest')}
            secs={exercise.restSecs}
            onChange={(secs) =>
              edit({
                kind: 'ExerciseRest',
                exercise: index,
                ...(secs == null ? {} : { value: secs }),
              })
            }
          />
        ) : null}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  handle: {
    minWidth: layout.minTapTarget,
    minHeight: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1 },
  name: { ...typography.bodyCompactBold },
  empty: { ...typography.caption, paddingHorizontal: spacing.sm },
  rest: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  restLabel: { ...typography.caption },
});
