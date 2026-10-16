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
import {
  colors as lightColors,
  darkColors,
  iconSize,
  layout,
  opacity,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';

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
      <MaterialCommunityIcons name="magnify" size={iconSize.md} color={themeColors.textSecondary} />
      <TextInput
        testID={testID}
        style={[styles.input, isDark && styles.inputDark]}
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={themeColors.textSecondary}
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
          hitSlop={CLEAR_SLOP}
          style={pressable()}
          android_ripple={pressRipple}
        >
          <MaterialCommunityIcons
            name="close-circle"
            size={iconSize.md}
            color={themeColors.textSecondary}
          />
        </Pressable>
      )}
    </View>
  );
}

const CLEAR_SLOP = slopToMinTapTarget(iconSize.md, iconSize.md);

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: opacity.overlay.light,
    borderRadius: layout.borderRadiusMd,
    paddingHorizontal: layout.cardMargin,
    gap: spacing.sm,
  },
  barDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  // The field fills the bar's height, so the whole bar takes the tap rather than
  // the one line of text inside it.
  input: {
    flex: 1,
    minHeight: layout.minTapTarget,
    fontSize: typography.bodyMedium.fontSize,
    color: lightColors.textPrimary,
    paddingVertical: 0,
  },
  inputDark: {
    color: darkColors.textPrimary,
  },
});
