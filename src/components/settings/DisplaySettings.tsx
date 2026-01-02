import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SegmentedButtons } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@/theme';
import { getThemePreference, type ThemePreference, type PrimarySport, getAvailableLanguages } from '@/providers';
import type { SupportedLocale } from '@/i18n';

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
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const availableLanguages = getAvailableLanguages();

  // Get the display label for the current language selection
  const currentLanguageLabel = React.useMemo(() => {
    const allLanguages = availableLanguages.flatMap(g => g.languages);

    // Check if it's a variant
    for (const lang of allLanguages) {
      if (lang.variants) {
        const variant = lang.variants.find(v => v.value === language);
        if (variant) {
          return `${lang.label} (${variant.label})`;
        }
      }
      if (lang.value === language || (language === null && lang.value === null)) {
        return lang.label;
      }
    }
    return 'System';
  }, [language, availableLanguages]);

  return (
    <>
      {/* Appearance Section */}
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.appearance').toUpperCase()}</Text>
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
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.language').toUpperCase()}</Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        {/* Current language display with expand toggle */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => setShowLanguages(!showLanguages)}
        >
          <MaterialCommunityIcons
            name="translate"
            size={22}
            color={colors.primary}
          />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {currentLanguageLabel}
          </Text>
          <MaterialCommunityIcons
            name={showLanguages ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={isDark ? '#666' : colors.textSecondary}
          />
        </TouchableOpacity>

        {/* Expanded language list */}
        {showLanguages && (
          <View style={styles.languageListContainer}>
            {availableLanguages.map((group) => (
              <View key={group.groupLabel ?? 'system'}>
                {/* Languages in group */}
                {group.languages.map((lang, langIndex) => {
                  const isSelected = language === lang.value || (language === null && lang.value === null);
                  const isLanguageVariant = lang.variants && lang.variants.some(v => v.value === language);
                  const showCheck = isSelected || isLanguageVariant;

                  return (
                    <TouchableOpacity
                      key={lang.value ?? 'system'}
                      style={[
                        styles.languageRow,
                        langIndex > 0 && styles.languageRowBorder,
                        isDark && styles.languageRowDark,
                      ]}
                      onPress={() => {
                        onLanguageChange(lang.value ?? 'system');
                        if (!lang.variants) {
                          setShowLanguages(false);
                        }
                      }}
                    >
                      <Text style={[styles.languageLabel, isDark && styles.textLight]}>
                        {lang.label}
                      </Text>
                      {/* Show regional variant chips */}
                      {lang.variants && (
                        <View style={styles.variantChips}>
                          {lang.variants.map((variant) => {
                            const isVariantSelected = language === variant.value;
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
                        <MaterialCommunityIcons
                          name="check"
                          size={20}
                          color={colors.primary}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Primary Sport Section */}
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.primarySport').toUpperCase()}</Text>
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
                value: 'Other',
                label: t('filters.other'),
                icon: 'dumbbell',
              },
            ]}
            style={styles.themePicker}
          />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    marginLeft: spacing.md,
  },
  textMuted: {
    color: '#666',
  },
  textLight: {
    color: '#fff',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: '#1c1c1e',
  },
  themePickerContainer: {
    padding: spacing.sm,
  },
  themePicker: {
    backgroundColor: 'transparent',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  languageListContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
    minHeight: 44,
  },
  languageRowBorder: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.05)',
  },
  languageRowDark: {
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  languageLabel: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  variantChips: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  variantChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  variantChipDark: {
    backgroundColor: '#2c2c2e',
    borderColor: 'rgba(255, 255, 255, 0.1)',
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
    color: colors.textPrimary,
  },
  variantChipTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
});
