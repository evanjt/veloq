/**
 * The one search field for the feed, map, routes and sections.
 *
 * Input handling lives here so every list behaves alike: no auto-capitalise,
 * the keyboard follows the app theme, return dismisses it.
 */

import React from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { colors as lightColors, darkColors, layout, opacity, spacing, typography } from '@/theme';

import { pressable, pressRipple } from './pressFeedback';

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
  const { isDark, colors: themeColors } = useTheme();

  return (
    <View style={[styles.bar, isDark && styles.barDark, style]}>
      <MaterialCommunityIcons name="magnify" size={20} color={themeColors.textSecondary} />
      <TextInput
        testID={testID}
        style={[styles.input, isDark && styles.inputDark]}
        placeholder={placeholder}
        placeholderTextColor={themeColors.textMuted}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={Keyboard.dismiss}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        keyboardAppearance={isDark ? 'dark' : 'light'}
        enablesReturnKeyAutomatically={Platform.OS === 'ios'}
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityLabel={t('common.clearSearch')}
          accessibilityRole="button"
          hitSlop={8}
          style={pressable()}
          android_ripple={pressRipple}
        >
          <MaterialCommunityIcons name="close-circle" size={18} color={themeColors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: opacity.overlay.light,
    borderRadius: layout.borderRadiusMd,
    paddingHorizontal: layout.cardMargin,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  barDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  input: {
    flex: 1,
    fontSize: typography.bodyMedium.fontSize,
    color: lightColors.textPrimary,
    paddingVertical: 0,
  },
  inputDark: {
    color: darkColors.textPrimary,
  },
});
