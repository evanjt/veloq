import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { FfiWeightUnit } from 'veloqrs';
import type { LiveStrengthEdit, FfiLiveStrengthExercise, FfiLiveStrengthSet } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { Button } from '@/shared/ui/Button';
import { ABSENT } from '@/shared/format/absent';
import { Icon } from '@/shared/ui/Icon';
import { IconButton } from '@/shared/ui/IconButton';
import { TextField } from '@/shared/ui/TextField';
import { colors, darkColors, iconSize, layout, opacity, spacing, typography } from '@/theme';

import { StrengthStepper } from './StrengthStepper';

const SIDES = ['left', 'right', 'both'] as const;

/** A hold is timed: it has a duration and no reps. */
function isTimed(set: FfiLiveStrengthSet): boolean {
  return set.durationSecs != null && set.reps == null;
}

interface StrengthSetRowProps {
  exerciseIndex: number;
  setIndex: number;
  exercise: FfiLiveStrengthExercise;
  set: FfiLiveStrengthSet;
  /** The unit the athlete reads and enters weight in. */
  weightUnit: FfiWeightUnit;
  /** The set the session is at. */
  current: boolean;
  edit: (change: LiveStrengthEdit) => void;
  /** Tick or untick the set; the screen decides what follows a tick. */
  toggleDone: () => void;
}

/**
 * One set: its number, reps and weight (or a duration for a hold) each with a stepper, a tick, a
 * plus that copies the set below it, and a more menu for side, warm-up and removal. Every control
 * sends one edit and draws what the engine answers.
 */
export function StrengthSetRow({
  exerciseIndex,
  setIndex,
  exercise,
  set,
  weightUnit,
  current,
  edit,
  toggleDone,
}: StrengthSetRowProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const [menuOpen, setMenuOpen] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [typedRefused, setTypedRefused] = useState(false);
  const id = `strength-set-${exerciseIndex}-${setIndex}`;
  const where = { exercise: exerciseIndex, set: setIndex };
  const n = setIndex + 1;
  const step = (kind: 'StepReps' | 'StepWeight' | 'StepDuration') => (direction: 1 | -1) =>
    edit({ kind, ...where, value: direction });
  const weightKey =
    weightUnit === FfiWeightUnit.Pound
      ? 'strength.recorder.weightLb'
      : 'strength.recorder.weightKg';
  const unitLabel = t(weightKey, { value: '' }).trim();
  const confirmTyped = () => {
    const entered = Number((typed ?? '').trim().replace(',', '.'));
    if ((typed ?? '').trim() === '' || !Number.isFinite(entered) || entered < 0) {
      setTypedRefused(true);
      return;
    }
    edit({ kind: 'SetWeightEntered', ...where, value: entered });
    setTyped(null);
    setTypedRefused(false);
  };
  const openKeypad = () => {
    setTypedRefused(false);
    setTyped((open) => (open == null ? String(set.displayWeight ?? '') : null));
  };

  return (
    <View testID={id}>
      <View
        style={[
          styles.row,
          current && { backgroundColor: palette.fillNeutral },
          set.done && styles.done,
        ]}
      >
        <View style={styles.number}>
          <Button
            testID={`${id}-select`}
            variant="ghost"
            size="sm"
            label={String(n)}
            accessibilityLabel={t('strength.recorder.doNext', { n })}
            onPress={() => edit({ kind: 'SelectSet', ...where })}
          />
          {set.warmUp ? (
            <Text style={[styles.tag, { color: palette.textSecondary }]}>
              {t('strength.recorder.warmUp')}
            </Text>
          ) : null}
        </View>

        <View style={styles.steppers}>
          {isTimed(set) ? (
            <StrengthStepper
              testID={`${id}-duration`}
              label={t('strength.recorder.whatDuration')}
              incrementLabel={t('strength.recorder.increase', {
                what: t('strength.recorder.whatDuration'),
              })}
              decrementLabel={t('strength.recorder.decrease', {
                what: t('strength.recorder.whatDuration'),
              })}
              reading={t('strength.recorder.seconds', { value: set.durationSecs ?? 0 })}
              onStep={step('StepDuration')}
            />
          ) : (
            <StrengthStepper
              testID={`${id}-reps`}
              label={t('strength.recorder.whatReps')}
              incrementLabel={t('strength.recorder.increase', {
                what: t('strength.recorder.whatReps'),
              })}
              decrementLabel={t('strength.recorder.decrease', {
                what: t('strength.recorder.whatReps'),
              })}
              reading={String(set.reps ?? ABSENT)}
              onStep={step('StepReps')}
            />
          )}
          {isTimed(set) ? null : (
            <StrengthStepper
              testID={`${id}-weight`}
              label={t('strength.recorder.whatWeight')}
              incrementLabel={t('strength.recorder.increase', {
                what: t('strength.recorder.whatWeight'),
              })}
              decrementLabel={t('strength.recorder.decrease', {
                what: t('strength.recorder.whatWeight'),
              })}
              reading={
                set.displayWeight == null ? ABSENT : t(weightKey, { value: set.displayWeight })
              }
              onStep={step('StepWeight')}
              onReadingPress={openKeypad}
            />
          )}
        </View>

        <View style={styles.actions}>
          <IconButton
            testID={`${id}-done`}
            compact
            variant={set.done ? 'primary' : 'secondary'}
            accessibilityLabel={t(
              set.done ? 'strength.recorder.markNotDone' : 'strength.recorder.markDone',
              {
                n,
              }
            )}
            accessibilityState={{ checked: set.done }}
            onPress={toggleDone}
          >
            <Icon
              name="check"
              size={iconSize.sm}
              color={set.done ? palette.textOnFill : palette.textSecondary}
            />
          </IconButton>
          <IconButton
            testID={`${id}-add`}
            compact
            variant="ghost"
            accessibilityLabel={t('strength.recorder.addSet', { n })}
            onPress={() => edit({ kind: 'AddSet', exercise: exerciseIndex, set: setIndex })}
          >
            <Icon name="plus" size={iconSize.sm} color={palette.textSecondary} />
          </IconButton>
          <IconButton
            testID={`${id}-more`}
            compact
            variant="ghost"
            selected={menuOpen}
            accessibilityLabel={t('strength.recorder.moreOnSet', { n })}
            onPress={() => setMenuOpen((open) => !open)}
          >
            <Icon name="dots-horizontal" size={iconSize.sm} color={palette.textSecondary} />
          </IconButton>
        </View>
      </View>

      {typed != null ? (
        <View style={styles.menu}>
          <TextField
            testID={`${id}-weight-entry`}
            label={t('strength.recorder.enterWeight')}
            unit={unitLabel}
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              setTypedRefused(false);
            }}
            error={typedRefused ? t('strength.recorder.weightInvalid') : null}
            keyboardType="decimal-pad"
            autoFocus
            selectTextOnFocus
            onSubmitEditing={confirmTyped}
          />
          <Button
            testID={`${id}-weight-confirm`}
            size="sm"
            label={t('strength.recorder.setWeight')}
            onPress={confirmTyped}
          />
        </View>
      ) : null}

      {menuOpen ? (
        <View style={styles.menu}>
          <Button
            testID={`${id}-warm-up`}
            size="sm"
            variant={set.warmUp ? 'primary' : 'secondary'}
            label={t('strength.recorder.warmUp')}
            onPress={() => edit({ kind: 'SetWarmUp', ...where, flag: !set.warmUp })}
          />
          {exercise.oneSided
            ? SIDES.map((side) => (
                <Button
                  key={side}
                  testID={`${id}-side-${side}`}
                  size="sm"
                  variant={set.side === side ? 'primary' : 'secondary'}
                  label={t(
                    side === 'left'
                      ? 'strength.recorder.sideLeft'
                      : side === 'right'
                        ? 'strength.recorder.sideRight'
                        : 'strength.recorder.sideBoth'
                  )}
                  onPress={() =>
                    edit({
                      kind: 'SetSide',
                      ...where,
                      ...(set.side === side ? {} : { text: side }),
                    })
                  }
                />
              ))
            : null}
          <Button
            testID={`${id}-remove`}
            size="sm"
            variant="ghost"
            label={t('strength.recorder.removeSet')}
            onPress={() => {
              setMenuOpen(false);
              edit({ kind: 'RemoveSet', ...where });
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusMd,
  },
  done: { opacity: opacity.dim },
  number: { alignItems: 'center', justifyContent: 'center' },
  tag: { ...typography.caption },
  steppers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: spacing.xs, marginLeft: 'auto' },
  menu: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
});
