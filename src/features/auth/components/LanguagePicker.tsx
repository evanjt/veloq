import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useLanguageStore, languageLabel } from '@/shared/app/LanguageStore';
import {
  brand,
  colors,
  darkColors,
  iconSize,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
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

const BUTTON_BORDER_WIDTH = 1;
const LANGUAGE_BUTTON_HEIGHT =
  typography.bodySmall.lineHeight + 2 * (spacing.xs + BUTTON_BORDER_WIDTH);

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
    borderWidth: BUTTON_BORDER_WIDTH,
    borderColor: colors.border,
  },
  languageButtonDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
  languageButtonDialect: {
    borderColor: brand.gold,
    borderWidth: 2,
  },
  languageButtonDialectDark: {
    borderColor: brand.goldLight,
  },
  languageButtonText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  languageDropdown: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
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
