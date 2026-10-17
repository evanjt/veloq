/**
 * A row of picture options: a circle per option with its name underneath, the chosen one ringed.
 *
 * For a choice that is easier seen than read, such as a map style. The name sits on a line of its
 * own under the circle and is never capped, so a long translation or the largest system text size
 * wraps it instead of cutting it off. The circles take the row's width in equal shares up to their
 * full size, so a narrow phone draws smaller circles rather than squeezing the names.
 */

import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/shared/app';
import { colors, controlHeight, darkColors, spacing, typography, stroke } from '@/theme';
import { pressable, pressRipple } from './pressFeedback';

const GAP = spacing.sm;
/** The smallest circle that still reads as a picture, as tall as a button. */
const MIN_CIRCLE = controlHeight.button;

/**
 * The circle's diameter for `count` options sharing a row `rowWidth` wide, capped at `max`.
 *
 * Before the row has been laid out its width is unknown, and the full size is drawn.
 */
export function circleOptionSize(rowWidth: number, count: number, max: number): number {
  if (rowWidth <= 0 || count <= 0) return max;
  const share = (rowWidth - GAP * (count - 1)) / count - stroke.two * 2;
  return Math.max(MIN_CIRCLE, Math.min(max, Math.floor(share)));
}

export interface CircleOption<T extends string> {
  value: T;
  label: string;
  /** What the circle shows, drawn to fill a `size` square. */
  render: (size: number) => React.ReactNode;
}

export interface CircleOptionRowProps<T extends string> {
  options: readonly CircleOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** The circle's full diameter, drawn when the row has the room. */
  maxSize: number;
  /** The row's test id; each option takes `${testIDPrefix}-${value}`. */
  testID?: string;
  testIDPrefix?: string;
  style?: StyleProp<ViewStyle>;
}

export function CircleOptionRow<T extends string>({
  options,
  value,
  onValueChange,
  maxSize,
  testID,
  testIDPrefix,
  style,
}: CircleOptionRowProps<T>) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const [rowWidth, setRowWidth] = useState(0);
  const size = circleOptionSize(rowWidth, options.length, maxSize);

  const onLayout = (event: LayoutChangeEvent) => setRowWidth(event.nativeEvent.layout.width);

  return (
    <View testID={testID} style={[styles.row, style]} onLayout={onLayout}>
      {options.map((option) => {
        const selected = option.value === value;
        const optionTestID = testIDPrefix && `${testIDPrefix}-${option.value}`;
        return (
          <Pressable
            key={option.value}
            testID={optionTestID}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onValueChange(option.value)}
            android_ripple={pressRipple}
            style={pressable(styles.option)}
          >
            <View
              style={[
                styles.ring,
                {
                  width: size + stroke.two * 2,
                  height: size + stroke.two * 2,
                  borderRadius: size / 2 + stroke.two,
                  borderColor: selected ? palette.primary : 'transparent',
                },
              ]}
            >
              <View
                testID={optionTestID ? `${optionTestID}-circle` : undefined}
                style={[
                  styles.circle,
                  { width: size, height: size, borderRadius: size / 2 },
                  { backgroundColor: palette.border },
                ]}
              >
                {option.render(size)}
              </View>
            </View>
            <Text
              style={[
                styles.label,
                { color: selected ? palette.actionLink : palette.textSecondary },
                selected && styles.labelSelected,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: GAP,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  ring: {
    borderWidth: stroke.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  circle: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    ...typography.caption,
    textAlign: 'center',
  },
  labelSelected: {
    ...typography.captionBold,
  },
});
