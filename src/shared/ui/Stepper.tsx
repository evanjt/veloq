/**
 * A minus and plus pair around a numeric reading, for a setting held between two bounds.
 *
 * The value is stored in one unit and shown in another, so a press moves to the next whole step
 * of the displayed unit and the result is written back in the stored unit, clamped to the bounds
 * there. The reading is one adjustable element for a screen reader, carrying the label, the
 * formatted reading and the increment and decrement actions, and each button is disabled at the
 * bound it would cross. The buttons stay separate elements beside the reading, so switch access
 * and VoiceOver's own navigation still reach each one.
 */

import React, { useCallback } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';

import { Icon } from './Icon';
import { IconButton } from './IconButton';

export interface StepperScale {
  /** Displayed units per stored unit: 3.28084 for metres shown as feet. */
  perStored: number;
  /** One press, in displayed units. */
  step: number;
}

export interface StepperBounds {
  /** Lower bound, in stored units. */
  min: number;
  /** Upper bound, in stored units. */
  max: number;
  scale: StepperScale;
}

/** A displayed value within this many steps of a grid line is on it, so a lossy round trip still moves. */
const GRID_TOLERANCE = 1e-6;

/**
 * The stored value one press away: the next whole step of the displayed unit in the direction
 * pressed, converted back and clamped to the bounds in the stored unit.
 */
export function stepValue(value: number, direction: 1 | -1, bounds: StepperBounds): number {
  const { min, max, scale } = bounds;
  const position = (value * scale.perStored) / scale.step;
  const index =
    direction > 0
      ? Math.floor(position + GRID_TOLERANCE) + 1
      : Math.ceil(position - GRID_TOLERANCE) - 1;
  const next = (index * scale.step) / scale.perStored;
  return Math.max(min, Math.min(max, next));
}

export interface StepperProps extends StepperBounds {
  /** The setting's name, which the adjustable element announces. */
  accessibilityLabel: string;
  decrementLabel: string;
  incrementLabel: string;
  /** The current value, in stored units. */
  value: number;
  /** The reading, in the athlete's unit, from a stored value. */
  format: (value: number) => string;
  onChange: (value: number) => void;
  /** Base id: the adjustable reading is `-value`, the buttons `-minus` and `-plus`. */
  testID?: string;
}

const STEP_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];

export function Stepper({
  accessibilityLabel,
  decrementLabel,
  incrementLabel,
  value,
  min,
  max,
  scale,
  format,
  onChange,
  testID,
}: StepperProps) {
  const { isDark } = useTheme();
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  const atMin = value <= min;
  const atMax = value >= max;
  const reading = format(value);
  const id = (part: string) => (testID ? { testID: `${testID}-${part}` } : {});

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = stepValue(value, direction, { min, max, scale });
      if (next !== value) onChange(next);
    },
    [value, min, max, scale, onChange]
  );

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') step(1);
      else if (event.nativeEvent.actionName === 'decrement') step(-1);
    },
    [step]
  );

  return (
    <View style={styles.controls}>
      <IconButton
        {...id('minus')}
        onPress={() => step(-1)}
        accessibilityLabel={decrementLabel}
        variant="secondary"
        disabled={atMin}
      >
        <Icon name="minus" size={iconSize.sm} color={textSecondary} />
      </IconButton>
      <View
        {...id('value')}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: reading }}
        accessibilityActions={STEP_ACTIONS}
        onAccessibilityAction={onAccessibilityAction}
        accessibilityLiveRegion="polite"
      >
        <Text style={[styles.value, { color: textPrimary }]}>{reading}</Text>
      </View>
      <IconButton
        {...id('plus')}
        onPress={() => step(1)}
        accessibilityLabel={incrementLabel}
        variant="secondary"
        disabled={atMax}
      >
        <Icon name="plus" size={iconSize.sm} color={textSecondary} />
      </IconButton>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  value: {
    ...typography.bodyBold,
    fontVariant: ['tabular-nums'],
    minWidth: 60,
    textAlign: 'center',
  },
});
