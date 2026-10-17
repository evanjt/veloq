/**
 * The one form field. Every place the athlete types a value draws this, so a
 * field is named, edged and sized the same way everywhere.
 *
 * - The label is always on screen and is also the field's accessible name, so
 *   a filled field still says what it holds. A placeholder is an example, never
 *   the label.
 * - A unit sits beside the value and is part of the name.
 * - An error replaces the supporting text under the field, and is spoken: a
 *   polite live region on Android, an announcement on iOS.
 * - The edge is `inputBoundary`, a mark at 3:1 on the theme's surfaces.
 * - The height is a minimum, so the user's text size grows the field rather than
 *   clipping it, and the keyboard follows the theme.
 * - A secret field carries its own show or hide control, so a paste can be
 *   checked before it is sent.
 *
 * Android draws Paper's outlined field with its floating label, iOS a plain
 * field with the label above it, which is each platform's own form idiom.
 * `SearchBar` stays its own control.
 */

import React, { useCallback, useImperativeHandle, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Text, TextInput as PaperTextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app/useTheme';
import {
  colors,
  darkColors,
  iconSize,
  inputBoundary,
  layout,
  spacing,
  typography,
  stroke,
} from '@/theme';

import { IconButton } from './IconButton';
import { secretReveal } from './secretReveal';
import { useAnnounceOnAppear } from './useAnnounceOnAppear';

/** What a caller may do to a field it holds: move focus into it or out. */
export type TextFieldHandle = Pick<TextInput, 'focus' | 'blur'>;

/** The input props a caller passes through unchanged, credentials and autofill among them. */
type PassThrough = Pick<
  TextInputProps,
  | 'autoCapitalize'
  | 'autoComplete'
  | 'autoCorrect'
  | 'autoFocus'
  | 'editable'
  | 'importantForAutofill'
  | 'maxLength'
  | 'multiline'
  | 'numberOfLines'
  | 'onBlur'
  | 'onSubmitEditing'
  | 'passwordRules'
  | 'placeholder'
  | 'returnKeyType'
  | 'selectTextOnFocus'
  | 'textContentType'
>;

export interface TextFieldProps extends PassThrough {
  /** What the field holds. Shown at all times and used as its accessible name. */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /**
   * The form refuses to go on without it. The visible label carries an
   * asterisk; the accessible name does not, so a screen reader does not read
   * "star", and the error on submit says what is missing.
   */
  required?: boolean;
  /** The unit the value is in, drawn after it and read with the label. */
  unit?: string | null | undefined;
  /** Supporting text under the field, such as the accepted range. */
  hint?: string | null | undefined;
  /** Why the value is refused. Replaces the hint and is announced. */
  error?: string | null | undefined;
  keyboardType?: KeyboardTypeOptions;
  /**
   * The value is a secret, hidden until the athlete presses the reveal control
   * beside it, which takes `${testID}-reveal`.
   */
  secureTextEntry?: boolean;
  /**
   * The field sits on a ground that is dark in both themes, the hero scrim over
   * a map, so it takes the dark palette and keyboard whatever the theme.
   */
  onDarkGround?: boolean;
  /** On the input. The error line takes `${testID}-error`, the reveal control `${testID}-reveal`. */
  testID?: string;
  ref?: React.Ref<TextFieldHandle>;
  /** Outer spacing only. The field's own look is fixed. */
  style?: StyleProp<ViewStyle>;
}

const NUMERIC_KEYBOARDS: ReadonlySet<KeyboardTypeOptions> = new Set([
  'numeric',
  'number-pad',
  'decimal-pad',
  'phone-pad',
]);

export function TextField({
  label,
  value,
  onChangeText,
  required = false,
  unit,
  hint,
  error,
  keyboardType,
  returnKeyType,
  secureTextEntry = false,
  onDarkGround = false,
  testID,
  ref,
  style,
  onBlur,
  multiline,
  placeholder,
  numberOfLines,
  ...passThrough
}: TextFieldProps) {
  const { t } = useTranslation();
  const { isDark: themeDark } = useTheme();
  const isDark = themeDark || onDarkGround;
  const palette = isDark ? darkColors : colors;
  const boundary = isDark ? inputBoundary.dark : inputBoundary.light;
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const reveal = secureTextEntry ? secretReveal(revealed, t) : null;
  const toggleReveal = useCallback(() => setRevealed((shown) => !shown), []);
  const revealID = testID ? { testID: `${testID}-reveal` } : {};

  const input = useRef<TextFieldHandle | null>(null);
  const setInput = useCallback((node: TextFieldHandle | null) => {
    input.current = node;
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      blur: () => input.current?.blur(),
    }),
    []
  );

  useAnnounceOnAppear(error);

  const handleBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
    (event) => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur]
  );

  // React Native puts the Done accessory on an iOS number pad only when a
  // return key type is set, so a numeric field without one cannot be finished.
  const returnKey =
    returnKeyType ?? (keyboardType && NUMERIC_KEYBOARDS.has(keyboardType) ? 'done' : undefined);

  const accessibilityHint = error ?? hint;
  const inputProps = {
    ...passThrough,
    value,
    onChangeText,
    accessibilityLabel: unit ? `${label}, ${unit}` : label,
    keyboardAppearance: isDark ? 'dark' : 'light',
    placeholderTextColor: palette.textSecondary,
    onFocus: () => setFocused(true),
    onBlur: handleBlur,
    // Set only when present: Paper's props refuse an explicit undefined.
    ...(testID !== undefined && { testID }),
    ...(keyboardType !== undefined && { keyboardType }),
    ...(returnKey !== undefined && { returnKeyType: returnKey }),
    ...(multiline !== undefined && { multiline }),
    ...(placeholder !== undefined && { placeholder }),
    ...(numberOfLines !== undefined && { numberOfLines }),
    ...(secureTextEntry && { secureTextEntry: !revealed }),
    ...(accessibilityHint && { accessibilityHint }),
  } satisfies TextInputProps;

  const shownLabel = required ? `${label} *` : label;

  // The live region stays mounted so Android hears an error that arrives in it.
  const supporting = (
    <View accessibilityLiveRegion="polite">
      {error ? (
        <Text
          testID={testID ? `${testID}-error` : undefined}
          style={[styles.supporting, { color: palette.errorDeep }]}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.supporting, { color: palette.textSecondary }]}>{hint}</Text>
      ) : null}
    </View>
  );

  if (Platform.OS === 'android') {
    return (
      <View style={style}>
        <PaperTextInput
          {...inputProps}
          ref={setInput}
          mode="outlined"
          label={shownLabel}
          error={!!error}
          outlineColor={boundary}
          activeOutlineColor={palette.primary}
          textColor={palette.textPrimary}
          style={{ backgroundColor: palette.surface }}
          // Paper caps the field's text at 1.5x by default; zero lifts the cap.
          maxFontSizeMultiplier={0}
          right={
            reveal ? (
              <PaperTextInput.Icon
                {...revealID}
                icon={reveal.icon}
                accessibilityLabel={reveal.accessibilityLabel}
                accessibilityState={reveal.accessibilityState}
                onPress={toggleReveal}
              />
            ) : unit ? (
              <PaperTextInput.Affix text={unit} />
            ) : undefined
          }
        />
        {supporting}
      </View>
    );
  }

  const edge = error ? palette.errorDeep : focused ? palette.primary : boundary;

  return (
    <View style={style}>
      {/* The field carries the label as its name, so the visible one is not a second stop. */}
      <Text
        style={[styles.label, { color: palette.textSecondary }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {shownLabel}
      </Text>
      <View
        style={[
          styles.box,
          multiline && styles.boxMultiline,
          { borderColor: edge, backgroundColor: palette.surface },
        ]}
      >
        <TextInput
          {...inputProps}
          ref={setInput}
          textAlignVertical={multiline ? 'top' : 'center'}
          style={[styles.input, { color: palette.textPrimary }]}
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
        {reveal ? (
          <IconButton
            {...revealID}
            accessibilityLabel={reveal.accessibilityLabel}
            accessibilityState={reveal.accessibilityState}
            onPress={toggleReveal}
          >
            <MaterialCommunityIcons
              name={reveal.icon}
              size={iconSize.md}
              color={palette.textSecondary}
            />
          </IconButton>
        ) : null}
      </View>
      {supporting}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typography.bodySmall,
    marginBottom: spacing.xs,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.minTapTarget,
    borderWidth: stroke.one,
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.smPlus,
    gap: spacing.sm,
  },
  boxMultiline: {
    alignItems: 'flex-start',
    minHeight: layout.minTapTarget * 2,
  },
  input: {
    ...typography.body,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  unit: {
    ...typography.body,
  },
  supporting: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
});
