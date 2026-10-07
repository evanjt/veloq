import React, { memo } from 'react';
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/shared/app';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, brand, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { type PrimarySport } from '@/features/fitness';
import {
  getAvailableLanguages,
  languageLabel,
  isEnglishVariant,
  getEnglishVariantValue,
  isLanguageVariant,
} from '@/shared/app/LanguageStore';
import { type ThemePreference } from '@/shared/app/ThemeProvider';
import {
  type UnitPreference,
  type IntervalsUnitPreferences,
  getIntervalsUnitSystem,
} from '@/shared/app/UnitPreferenceStore';
import { ToggleButtonRow, pressable, pressRipple } from '@/shared/ui';

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
}: DisplaySettingsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const availableLanguages = getAvailableLanguages();

  const currentLanguageLabel = languageLabel(language).label;

  const displayContent = (
    <>
      {/* Appearance */}
      <View style={styles.subsectionHeader}>
        <MaterialCommunityIcons
          name="theme-light-dark"
          size={18}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
        <Text style={[styles.subsectionLabel, isDark && settingsStyles.textMuted]}>
          {t('settings.appearance')}
        </Text>
      </View>
      <View testID="settings-theme-toggle" style={styles.themePickerContainer}>
        <ToggleButtonRow
          value={themePreference}
          onValueChange={onThemeChange}
          options={[
            { value: 'system', label: t('settings.system'), testID: 'theme-button-system' },
            { value: 'light', label: t('settings.light'), testID: 'theme-button-light' },
            { value: 'dark', label: t('settings.dark'), testID: 'theme-button-dark' },
          ]}
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
        <Text style={[styles.subsectionLabel, isDark && settingsStyles.textMuted]}>
          {t('settings.units')}
        </Text>
      </View>
      <View testID="settings-unit-toggle" style={styles.themePickerContainer}>
        <ToggleButtonRow
          value={unitPreference}
          onValueChange={onUnitChange}
          options={[
            { value: 'auto', label: t('settings.unitsAuto') },
            { value: 'metric', label: t('settings.unitsMetric') },
            { value: 'imperial', label: t('settings.unitsImperial') },
          ]}
        />
      </View>
      <Text style={[styles.subsectionHint, isDark && settingsStyles.textMuted]}>
        {unitPreference === 'auto'
          ? intervalsUnitPreference
            ? t('settings.unitsAutoHintWithIntervals', {
                setting:
                  getIntervalsUnitSystem(intervalsUnitPreference) === 'metric'
                    ? t('settings.unitsMetric')
                    : t('settings.unitsImperial'),
              })
            : t('settings.unitsAutoHint')
          : unitPreference === 'metric'
            ? t('settings.unitsMetricHint')
            : t('settings.unitsImperialHint')}
      </Text>

      <View style={[styles.divider, isDark && styles.dividerDark]} />

      {/* Language */}
      <View style={styles.languageHeader}>
        <MaterialCommunityIcons
          name="translate"
          size={22}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
        <Text style={[styles.subsectionLabel, isDark && settingsStyles.textLight]}>
          {t('settings.language')}
        </Text>
        <Text
          style={[
            styles.subsectionHint,
            isDark && settingsStyles.textMuted,
            { flex: 0, marginTop: 0, marginBottom: 0 },
          ]}
        >
          {currentLanguageLabel}
        </Text>
        {(language === 'en-AU' || language === 'de-CH') && (
          <View style={[styles.dialectLegendChip, isDark && styles.dialectLegendChipDark]}>
            <Text style={[styles.dialectLegendText, isDark && settingsStyles.textMuted]}>
              {t('settings.dialect')}
            </Text>
          </View>
        )}
      </View>
      <View>
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
                <Pressable
                  onPress={() => {
                    // For languages with variants, use the defaultVariant (or first variant)
                    const valueToUse =
                      lang.defaultVariant ?? lang.variants?.[0]?.value ?? lang.value;
                    onLanguageChange(valueToUse);
                  }}
                  style={pressable(styles.languageLabelContainer)}
                  android_ripple={pressRipple}
                >
                  <Text style={[styles.languageLabel, isDark && settingsStyles.textLight]}>
                    {lang.label}
                  </Text>
                </Pressable>
                {lang.variants && (
                  <View style={styles.variantChips}>
                    {lang.variants.map((variant) => {
                      const isVariantSelected =
                        language === variant.value ||
                        (lang.value === 'en' &&
                          isEnglishVariant(language) &&
                          getEnglishVariantValue(language) === variant.value);
                      return (
                        <Pressable
                          key={variant.value}
                          style={pressable([
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
                          ])}
                          android_ripple={pressRipple}
                          onPress={() => {
                            onLanguageChange(variant.value);
                          }}
                        >
                          <Text
                            style={[
                              styles.variantChipText,
                              isVariantSelected && styles.variantChipTextSelected,
                              isDark && !isVariantSelected && settingsStyles.textMuted,
                            ]}
                          >
                            {variant.label}
                          </Text>
                        </Pressable>
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
      </View>
    </>
  );

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.display').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {displayContent}

        <View style={[styles.divider, isDark && styles.dividerDark]} />
        <View style={styles.subsectionHeader}>
          <MaterialCommunityIcons
            name="run"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.subsectionLabel, isDark && settingsStyles.textMuted]}>
            {t('settings.primarySport')}
          </Text>
        </View>
        <View style={styles.themePickerContainer}>
          <ToggleButtonRow
            value={primarySport}
            onValueChange={onSportChange}
            options={[
              { value: 'Cycling', label: t('filters.cycling') },
              { value: 'Running', label: t('filters.running') },
              { value: 'Swimming', label: t('filters.swimming') },
            ]}
          />
        </View>
        <Text style={[styles.embeddedHint, isDark && settingsStyles.textMuted]}>
          {primarySport === 'Cycling'
            ? t('settings.primarySportHintCycling')
            : primarySport === 'Running'
              ? t('settings.primarySportHintRunning')
              : t('settings.primarySportHintSwimming')}
        </Text>
      </View>
    </>
  );
}

// Memoize to prevent re-renders when parent re-renders
export const DisplaySettings = memo(DisplaySettingsComponent);

const styles = StyleSheet.create({
  themePickerContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  subsectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  languageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  subsectionLabel: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  subsectionHint: {
    ...typography.label,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    textTransform: 'none',
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
    ...typography.body,
    color: colors.textPrimary,
  },
  variantChips: {
    flexDirection: 'row',
    gap: spacing.xsPlus,
    marginLeft: 'auto',
  },
  variantChip: {
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm + 4,
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
    ...typography.bodyCompact,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  variantChipTextSelected: {
    color: colors.textOnPrimary,
  },
  dialectLegendChip: {
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm + 4,
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
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  embeddedHint: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    fontStyle: 'italic',
  },
});
