import { StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { Icon } from '@/shared/ui/Icon';
import { IconButton } from '@/shared/ui/IconButton';
import { Button } from '@/shared/ui/Button';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';

const STEP_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];
const TYPED_STEP_ACTIONS = [...STEP_ACTIONS, { name: 'activate' }];

interface StrengthStepperProps {
  /** What the stepper changes, read by a screen reader with the reading. */
  label: string;
  incrementLabel: string;
  decrementLabel: string;
  /** The reading as the athlete reads it. */
  reading: string;
  /** One tap, up (1) or down (-1). The engine decides what a step is worth. */
  onStep: (direction: 1 | -1) => void;
  /**
   * A tap on the reading, or an activate from a screen reader, asks to type the value. Without
   * it the reading is read only.
   */
  onReadingPress?: (() => void) | undefined;
  /** Base id: the reading is `-value`, the buttons `-minus` and `-plus`. */
  testID: string;
}

/**
 * A minus and plus pair around a reading. It owns no value and no step size: a tap names a
 * direction and the engine answers with the new session.
 */
export function StrengthStepper({
  label,
  incrementLabel,
  decrementLabel,
  reading,
  onStep,
  onReadingPress,
  testID,
}: StrengthStepperProps) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;

  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') onStep(1);
    else if (event.nativeEvent.actionName === 'decrement') onStep(-1);
    else if (event.nativeEvent.actionName === 'activate') onReadingPress?.();
  };

  return (
    <View style={styles.row}>
      <IconButton
        testID={`${testID}-minus`}
        compact
        variant="secondary"
        accessibilityLabel={decrementLabel}
        onPress={() => onStep(-1)}
      >
        <Icon name="minus" size={iconSize.sm} color={palette.textSecondary} />
      </IconButton>
      <View
        testID={`${testID}-value`}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: reading }}
        accessibilityActions={onReadingPress ? TYPED_STEP_ACTIONS : STEP_ACTIONS}
        onAccessibilityAction={onAction}
        style={styles.value}
      >
        {onReadingPress ? (
          <Button
            testID={`${testID}-open-keypad`}
            variant="ghost"
            size="sm"
            label={reading}
            onPress={onReadingPress}
          />
        ) : (
          <Text style={[styles.text, { color: palette.textPrimary }]}>{reading}</Text>
        )}
      </View>
      <IconButton
        testID={`${testID}-plus`}
        compact
        variant="secondary"
        accessibilityLabel={incrementLabel}
        onPress={() => onStep(1)}
      >
        <Icon name="plus" size={iconSize.sm} color={palette.textSecondary} />
      </IconButton>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  value: { minWidth: spacing.xxl, alignItems: 'center' },
  text: { ...typography.bodyCompactBold },
});
