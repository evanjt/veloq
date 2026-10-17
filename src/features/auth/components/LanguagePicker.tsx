import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useLanguageStore, languageLabel } from '@/shared/app/LanguageStore';
import {
  colors,
  darkColors,
  iconSize,
  inputBoundary,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
  stroke,
} from '@/theme';
import { useTheme } from '@/shared/app';
import { LanguageList, pressable, pressRipple } from '@/shared/ui';

export const LanguagePicker = React.memo(function LanguagePicker() {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const [showLanguages, setShowLanguages] = React.useState(false);

  const { label: currentLanguageLabel, isDialect: isDialectSelected } = languageLabel(language);

  const handleLanguageChange = async (value: string) => {
    await setLanguage(value);
    setShowLanguages(false);
  };

  return (
    <>
      {/* Language Selector - top right */}
      <View style={styles.languagePickerContainer}>
        <Pressable
          testID="login-language-button"
          style={pressable([
            styles.languageButton,
            isDark && styles.languageButtonDark,
            isDialectSelected && styles.languageButtonDialect,
            isDialectSelected && isDark && styles.languageButtonDialectDark,
          ])}
          android_ripple={pressRipple}
          hitSlop={slopToMinTapTarget(LANGUAGE_BUTTON_HEIGHT)}
          onPress={() => setShowLanguages(!showLanguages)}
          accessibilityRole="button"
          accessibilityLabel={`${t('settings.language')}: ${currentLanguageLabel}`}
          accessibilityState={{ expanded: showLanguages, selected: isDialectSelected }}
        >
          <MaterialCommunityIcons
            name="translate"
            size={iconSize.md}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.languageButtonText, isDark && styles.textDark]}>
            {currentLanguageLabel}
          </Text>
          <MaterialCommunityIcons
            name={showLanguages ? 'chevron-up' : 'chevron-down'}
            size={iconSize.md}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
      </View>

      {/* Language Dropdown */}
      {showLanguages ? (
        <View style={[styles.languageDropdown, isDark && styles.languageDropdownDark]}>
          <LanguageList language={language} onSelect={handleLanguageChange} />
        </View>
      ) : null}
    </>
  );
});

const LANGUAGE_BUTTON_HEIGHT = typography.bodySmall.lineHeight + 2 * (spacing.xs + stroke.one);

const styles = StyleSheet.create({
  languagePickerContainer: {
    alignItems: 'flex-end',
    marginBottom: spacing.md,
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: LANGUAGE_BUTTON_HEIGHT,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: colors.surface,
    borderWidth: stroke.one,
    borderColor: colors.border,
  },
  languageButtonDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
  // A chosen dialect takes the outline the language list marks dialects with.
  languageButtonDialect: {
    borderColor: inputBoundary.light,
  },
  languageButtonDialectDark: {
    borderColor: inputBoundary.dark,
  },
  languageButtonText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  languageDropdown: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: stroke.one,
    borderColor: colors.border,
  },
  languageDropdownDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
