/**
 * The one form field: a visible label, an optional unit beside the value, and
 * an error line under it.
 *
 * The input carries the field's name, so a screen reader hears the label and
 * the unit together. The error is a status message: Android speaks it from a
 * polite live region that stays mounted, iOS hears it announced, and it rides
 * on the input as its hint so focusing the field again repeats it.
 */

import React from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

import { useAnnounceOnAppear } from './useAnnounceOnAppear';

export interface TextFieldProps extends Omit<
  TextInputProps,
  'style' | 'testID' | 'accessibilityLabel' | 'accessibilityHint' | 'placeholderTextColor'
> {
  /** The field's name, shown above it and read as its accessible name. */
  label: string;
  /** Shown after the value and read with the label, such as `km`. */
  unit?: string | null | undefined;
  /** Why the value is refused, or null while it is accepted. */
  error?: string | null | undefined;
  /** Marks the label as required. The marker is visual; the error says what is missing. */
  required?: boolean;
  /** The input's testID. The error line is `${testID}-error`. */
  testID: string;
  /** Outer spacing only. */
  style?: StyleProp<ViewStyle>;
  /** Extra input styling, such as a multiline field's height. */
  inputStyle?: StyleProp<TextStyle>;
}

export function TextField({
  label,
  unit,
  error,
  required = false,
  testID,
  style,
  inputStyle,
  ...input
}: TextFieldProps) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const message = error || null;
  useAnnounceOnAppear(message);

  return (
    <View style={style}>
      <Text
        style={[styles.label, { color: palette.textSecondary }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {required ? `${label} *` : label}
      </Text>
      <View
        style={[
          styles.box,
          {
            backgroundColor: palette.surface,
            borderColor: message ? palette.error : palette.border,
          },
        ]}
      >
        <TextInput
          {...input}
          testID={testID}
          accessibilityLabel={unit ? `${label}, ${unit}` : label}
          {...(message && { accessibilityHint: message })}
          placeholderTextColor={palette.textSecondary}
          style={[styles.input, { color: palette.textPrimary }, inputStyle]}
        />
        {unit ? (
          <Text
            style={[styles.unit, { color: palette.textSecondary }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {unit}
          </Text>
        ) : null}
      </View>
      <View accessibilityLiveRegion="polite">
        {message && (
          <Text testID={`${testID}-error`} style={[styles.error, { color: palette.errorDeep }]}>
            {message}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...typography.caption, marginBottom: spacing.xs },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
  },
  input: { ...typography.body, flex: 1, paddingVertical: spacing.sm },
  unit: { ...typography.body, marginLeft: spacing.xs },
  error: { ...typography.caption, marginTop: spacing.xxs },
});
