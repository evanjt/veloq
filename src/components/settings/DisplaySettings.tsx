import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '@/hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SegmentedButtons } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout } from '@/theme';
import {
  type ThemePreference,
  type PrimarySport,
  getAvailableLanguages,
  isEnglishVariant,
  getEnglishVariantValue,
  isLanguageVariant,
} from '@/providers';
import { CollapsibleSection } from '@/components/ui';

// LanguageChoice from useLanguageStore (string | null)
type LanguageChoice = string | null;

interface DisplaySettingsProps {
  themePreference: ThemePreference;
  onThemeChange: (value: string) => void;
  primarySport: PrimarySport;
  onSportChange: (value: string) => void;
  language: LanguageChoice;
  onLanguageChange: (value: string) => void;
  showLanguages: boolean;
  setShowLanguages: (show: boolean) => void;
}

export function DisplaySettings({
  themePreference,
  onThemeChange,
  primarySport,
  onSportChange,
  language,
  onLanguageChange,
  showLanguages,
  setShowLanguages,
}: DisplaySettingsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const availableLanguages = getAvailableLanguages();

  // Get the display label for the current language selection
  const currentLanguageLabel = React.useMemo(() => {
    for (const group of availableLanguages) {
      for (const lang of group.languages) {
        if (language === lang.value || (language === null && lang.value === null)) {
          return lang.label;
        }
        // Check variants
        if (lang.variants) {
          const variant = lang.variants.find((v) => v.value === language);
          if (variant) {
            return `${lang.label} (${variant.label})`;
          }
        }
        // Check if current language is a variant of this language
        if (lang.value && isLanguageVariant(language, lang.value)) {
          return lang.label;
        }
      }
    }
    return 'System';
  }, [language, availableLanguages]);

  return (
    <>
      {/* Appearance Section */}
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('settings.appearance').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        <View testID="settings-theme-toggle" style={styles.themePickerContainer}>
          <SegmentedButtons
            value={themePreference}
            onValueChange={onThemeChange}
            buttons={[
              {
                value: 'system',
                label: t('settings.system'),
                icon: 'cellphone',
              },
              {
                value: 'light',
                label: t('settings.light'),
                icon: 'white-balance-sunny',
              },
              {
                value: 'dark',
                label: t('settings.dark'),
                icon: 'moon-waning-crescent',
              },
            ]}
            style={styles.themePicker}
          />
        </View>
      </View>

      {/* Language Section */}
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('settings.language').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        <CollapsibleSection
          title={t('settings.language')}
          subtitle={currentLanguageLabel}
          expanded={showLanguages}
          onToggle={setShowLanguages}
          icon="translate"
          estimatedHeight={500}
        >
          {availableLanguages.flatMap((group, groupIndex) =>
            group.languages.map((lang, langIndex) => {
              const index = groupIndex * 100 + langIndex;
              const isSelected =
                language === lang.value || (language === null && lang.value === null);
              const isVariantOfThisLanguage =
                lang.value !== null && isLanguageVariant(language, lang.value);
              const showCheck = isSelected || isVariantOfThisLanguage;

              return (
                <TouchableOpacity
                  key={lang.value ?? 'system'}
                  style={[
                    styles.languageRow,
                    index > 0 && styles.languageRowBorder,
                    isDark && styles.languageRowDark,
                  ]}
                  onPress={() => {
                    onLanguageChange(lang.value ?? 'system');
                    setShowLanguages(false);
                  }}
                >
                  <Text style={[styles.languageLabel, isDark && styles.textLight]}>
                    {lang.label}
                  </Text>
                  {lang.variants && (
                    <View style={styles.variantChips}>
                      {lang.variants.map((variant) => {
                        const isVariantSelected =
                          language === variant.value ||
                          (lang.value === 'en' &&
                            isEnglishVariant(language) &&
                            getEnglishVariantValue(language) === variant.value);
                        return (
                          <TouchableOpacity
                            key={variant.value}
                            style={[
                              styles.variantChip,
                              isVariantSelected && styles.variantChipSelected,
                              isDark && styles.variantChipDark,
                              isVariantSelected && isDark && styles.variantChipSelectedDark,
                            ]}
                            onPress={(e) => {
                              e.stopPropagation();
                              onLanguageChange(variant.value);
                              setShowLanguages(false);
                            }}
                          >
                            <Text
                              style={[
                                styles.variantChipText,
                                isVariantSelected && styles.variantChipTextSelected,
                                isDark && !isVariantSelected && styles.textMuted,
                              ]}
                            >
                              {variant.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  {showCheck && !lang.variants && (
                    <MaterialCommunityIcons name="check" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </CollapsibleSection>
      </View>

      {/* Primary Sport Section */}
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('settings.primarySport').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        <View style={styles.themePickerContainer}>
          <SegmentedButtons
            value={primarySport}
            onValueChange={onSportChange}
            buttons={[
              {
                value: 'Cycling',
                label: t('filters.cycling'),
                icon: 'bike',
              },
              {
                value: 'Running',
                label: t('filters.running'),
                icon: 'run',
              },
              {
                value: 'Swimming',
                label: t('filters.swimming'),
                icon: 'swim',
              },
            ]}
            style={styles.themePicker}
          />
        </View>
      </View>
      <Text style={[styles.infoText, isDark && styles.textMuted]}>
        {primarySport === 'Cycling'
          ? t('settings.primarySportHintCycling')
          : primarySport === 'Running'
            ? t('settings.primarySportHintRunning')
            : t('settings.primarySportHintSwimming')}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  themePickerContainer: {
    padding: spacing.md,
  },
  themePicker: {
    // React Native Paper SegmentedButtons handles styling
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  languageRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  languageRowDark: {
    borderTopColor: darkColors.border,
  },
  languageLabel: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  variantChips: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 'auto',
  },
  variantChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  variantChipDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  variantChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  variantChipSelectedDark: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  variantChipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  variantChipTextSelected: {
    color: colors.textOnDark,
  },
  infoText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginHorizontal: layout.screenPadding,
    marginTop: spacing.md,
    lineHeight: 18,
  },
});
