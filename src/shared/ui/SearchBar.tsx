/**
 * The one search field for the feed, map, routes and sections.
 *
 * Input handling lives here so every list behaves alike: no auto-capitalise,
 * the keyboard follows the app theme, return dismisses it.
 *
 * The bar is a solid input well. Focus draws a 2 pt focus ring over its edge,
 * laid over the bar rather than added to it, so the list below does not move.
 */

import React, { useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  slopToMinTapTarget,
  spacing,
  stroke,
  typography,
} from '@/theme';

import { Icon } from './Icon';
import { PressTarget } from './PressTarget';

export interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  testID?: string;
  /** Outer spacing only. The bar's own look is fixed. */
  style?: StyleProp<ViewStyle>;
}

export function SearchBar({ value, onChangeText, placeholder, testID, style }: SearchBarProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.bar, { backgroundColor: palette.surfaceInput }, style]}>
      <Icon name="magnify" size={iconSize.md} color={palette.textSecondary} />
      <TextInput
        testID={testID}
        style={[styles.input, { color: palette.textPrimary }]}
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={palette.textTertiary}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={Keyboard.dismiss}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        keyboardAppearance={isDark ? 'dark' : 'light'}
        enablesReturnKeyAutomatically={Platform.OS === 'ios'}
      />
      {value.length > 0 && (
        <PressTarget
          onPress={() => onChangeText('')}
          accessibilityLabel={t('common.clearSearch')}
          accessibilityRole="button"
          hitSlop={CLEAR_SLOP}
        >
          <Icon name="close-circle" size={iconSize.md} color={palette.textSecondary} />
        </PressTarget>
      )}
      {focused ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.ring, { borderColor: palette.focusRing }]}
        />
      ) : null}
    </View>
  );
}

const CLEAR_SLOP = slopToMinTapTarget(iconSize.md, iconSize.md);

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: layout.borderRadiusMd,
    paddingHorizontal: layout.cardMargin,
    gap: spacing.sm,
  },
  ring: {
    borderWidth: stroke.two,
    borderRadius: layout.borderRadiusMd,
  },
  // The field fills the bar's height, so the whole bar takes the tap rather than
  // the one line of text inside it.
  input: {
    ...typography.bodyMedium,
    flex: 1,
    minHeight: layout.minTapTarget,
    paddingVertical: 0,
  },
});
