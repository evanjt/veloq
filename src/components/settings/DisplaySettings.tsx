import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '@/hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SegmentedButtons } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, brand } from '@/theme';
import {
  type ThemePreference,
  type PrimarySport,
  type UnitPreference,
  type IntervalsUnitPreferences,
  getAvailableLanguages,
  isEnglishVariant,
  getEnglishVariantValue,
  isLanguageVariant,
  getIntervalsPreferenceLabel,
} from '@/providers';
import { CollapsibleSection } from '@/components/ui';

// LanguageChoice from useLanguageStore (always a string now, no System option)
type LanguageChoice = string;

interface DisplaySettingsProps {
  themePreference: ThemePreference;
  onThemeChange: (value: string) => void;
  unitPreference: UnitPreference;
  onUnitChange: (value: string) => void;
  intervalsUnitPreference: IntervalsUnitPreferences | null;
  primarySport: PrimarySport;
  onSportChange: (value: string) => void;
  language: LanguageChoice;
  onLanguageChange: (value: string) => void;
  showLanguages: boolean;
  setShowLanguages: (show: boolean) => void;
}

function DisplaySettingsComponent({
  themePreference,
  onThemeChange,
  unitPreference,
  onUnitChange,
  intervalsUnitPreference,
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
        if (language === lang.value) {
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
        if (isLanguageVariant(language, lang.value)) {
          return lang.label;
        }
      }
    }
    return 'English'; // Fallback
  }, [language, availableLanguages]);

  return (
    <>
      {/* Display Settings Section - Appearance, Units, Language combined */}
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('settings.display').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        {/* Appearance */}
        <View style={styles.subsectionHeader}>
          <MaterialCommunityIcons
            name="theme-light-dark"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.subsectionLabel, isDark && styles.textMuted]}>
            {t('settings.appearance')}
          </Text>
        </View>
        <View testID="settings-theme-toggle" style={styles.themePickerContainer}>
          <SegmentedButtons
            value={themePreference}
            onValueChange={onThemeChange}
            buttons={[
              {
                value: 'system',
                label: t('settings.system'),
                icon: 'cellphone',
                testID: 'theme-button-system',
              },
              {
                value: 'light',
                label: t('settings.light'),
                icon: 'white-balance-sunny',
                testID: 'theme-button-light',
              },
              {
                value: 'dark',
                label: t('settings.dark'),
                icon: 'moon-waning-crescent',
                testID: 'theme-button-dark',
              },
            ]}
            style={styles.themePicker}
          />
        </View>

        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Units */}
        <View style={styles.subsectionHeader}>
          <MaterialCommunityIcons
            name="ruler"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.subsectionLabel, isDark && styles.textMuted]}>
            {t('settings.units')}
          </Text>
        </View>
        <View style={styles.themePickerContainer}>
          <SegmentedButtons
            value={unitPreference}
            onValueChange={onUnitChange}
            buttons={[
              {
                value: 'auto',
                label: t('settings.unitsAuto'),
                icon: 'cellphone-cog',
              },
              {
                value: 'metric',
                label: t('settings.unitsMetric'),
                icon: 'ruler',
              },
              {
                value: 'imperial',
                label: t('settings.unitsImperial'),
                icon: 'ruler',
              },
            ]}
            style={styles.themePicker}
          />
        </View>
        <Text style={[styles.subsectionHint, isDark && styles.textMuted]}>
          {unitPreference === 'auto'
            ? intervalsUnitPreference
              ? t('settings.unitsAutoHintWithIntervals', {
                  setting: getIntervalsPreferenceLabel(intervalsUnitPreference),
                })
              : t('settings.unitsAutoHint')
            : unitPreference === 'metric'
              ? t('settings.unitsMetricHint')
              : t('settings.unitsImperialHint')}
        </Text>

        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Language */}
        <CollapsibleSection
          title={t('settings.language')}
          subtitle={currentLanguageLabel}
          expanded={showLanguages}
          onToggle={setShowLanguages}
          icon="translate"
          estimatedHeight={500}
          headerRight={
            // Show dialect chip only when a dialect is selected
            language === 'en-AU' || language === 'de-CHZ' || language === 'de-CHB' ? (
              <View style={[styles.dialectLegendChip, isDark && styles.dialectLegendChipDark]}>
                <Text style={[styles.dialectLegendText, isDark && styles.textMuted]}>
                  {t('settings.dialect')}
                </Text>
              </View>
            ) : null
          }
        >
          {availableLanguages.flatMap((group, groupIndex) =>
            group.languages.map((lang, langIndex) => {
              const index = groupIndex * 100 + langIndex;
              const isSelected = language === lang.value;
              const isVariantOfThisLanguage = isLanguageVariant(language, lang.value);
              const showCheck = isSelected || isVariantOfThisLanguage;

              return (
                <View
                  key={lang.value}
                  style={[
                    styles.languageRow,
                    index > 0 && styles.languageRowBorder,
                    isDark && styles.languageRowDark,
                  ]}
                >
                  <TouchableOpacity
                    onPress={() => {
                      // For languages with variants, use the defaultVariant (or first variant)
                      const valueToUse =
                        lang.defaultVariant ?? lang.variants?.[0]?.value ?? lang.value;
                      onLanguageChange(valueToUse);
                      setShowLanguages(false);
                    }}
                    style={styles.languageLabelContainer}
                  >
                    <Text style={[styles.languageLabel, isDark && styles.textLight]}>
                      {lang.label}
                    </Text>
                  </TouchableOpacity>
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
                              isDark && styles.variantChipDark,
                              // Non-selected dialect: gold dotted border
                              variant.isDialect && !isVariantSelected && styles.variantChipDialect,
                              variant.isDialect &&
                                !isVariantSelected &&
                                isDark &&
                                styles.variantChipDialectDark,
                              // Selected: teal background
                              isVariantSelected && styles.variantChipSelected,
                              isVariantSelected && isDark && styles.variantChipSelectedDark,
                              // Selected dialect: keep gold dotted border with teal background
                              variant.isDialect &&
                                isVariantSelected &&
                                styles.variantChipDialectSelected,
                              variant.isDialect &&
                                isVariantSelected &&
                                isDark &&
                                styles.variantChipDialectSelectedDark,
                            ]}
                            onPress={() => {
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
                </View>
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

// Memoize to prevent re-renders when parent re-renders
export const DisplaySettings = memo(DisplaySettingsComponent);

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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  themePicker: {
    // React Native Paper SegmentedButtons handles styling
  },
  subsectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  subsectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  subsectionHint: {
    fontSize: 11,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    lineHeight: 14,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
  },
  dividerDark: {
    backgroundColor: darkColors.border,
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
  languageLabelContainer: {
    flex: 1,
    paddingVertical: spacing.xs,
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
  variantChipDialect: {
    borderColor: brand.gold,
  },
  variantChipDialectDark: {
    borderColor: brand.goldLight,
  },
  variantChipDialectSelected: {
    borderColor: brand.gold,
    borderWidth: 2,
  },
  variantChipDialectSelectedDark: {
    borderColor: brand.goldLight,
    borderWidth: 2,
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
  dialectLegendChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: brand.gold,
    backgroundColor: colors.background,
    marginRight: spacing.sm,
  },
  dialectLegendChipDark: {
    borderColor: brand.goldLight,
    backgroundColor: darkColors.surfaceElevated,
  },
  dialectLegendText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
});
