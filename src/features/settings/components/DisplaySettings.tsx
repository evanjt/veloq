import React, { memo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/shared/app';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { type PrimarySport } from '@/features/fitness';
import { languageLabel } from '@/shared/app/LanguageStore';
import { type ThemePreference } from '@/shared/app/ThemeProvider';
import {
  type UnitPreference,
  type IntervalsUnitPreferences,
  getIntervalsUnitSystem,
} from '@/shared/app/UnitPreferenceStore';
import { LanguageList, ListSectionHeader, ToggleButtonRow } from '@/shared/ui';

// LanguageChoice from useLanguageStore: 'system' or an explicit locale
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

  const currentLanguageLabel = languageLabel(language).label;

  const displayContent = (
    <>
      {/* Appearance */}
      <View style={styles.subsectionHeader}>
        <MaterialCommunityIcons
          name="theme-light-dark"
          size={iconSize.md}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
        <Text style={[styles.subsectionLabel, isDark && settingsStyles.textSecondary]}>
          {t('settings.appearance')}
        </Text>
      </View>
      <View testID="settings-theme-toggle" style={styles.themePickerContainer}>
        <ToggleButtonRow
          value={themePreference}
          onValueChange={onThemeChange}
          options={[
            {
              value: 'system',
              label: t('settings.system'),
              testID: 'theme-button-system',
            },
            {
              value: 'light',
              label: t('settings.light'),
              testID: 'theme-button-light',
            },
            {
              value: 'dark',
              label: t('settings.dark'),
              testID: 'theme-button-dark',
            },
          ]}
        />
      </View>

      <View style={[styles.divider, isDark && styles.dividerDark]} />

      {/* Units */}
      <View style={styles.subsectionHeader}>
        <MaterialCommunityIcons
          name="ruler"
          size={iconSize.md}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
        <Text style={[styles.subsectionLabel, isDark && settingsStyles.textSecondary]}>
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
      <Text style={[styles.subsectionHint, isDark && settingsStyles.textSecondary]}>
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
      <View style={[styles.subsectionHeader, styles.languageHeader]}>
        <MaterialCommunityIcons
          name="translate"
          size={iconSize.md}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
        <Text style={[styles.subsectionLabel, isDark && settingsStyles.textSecondary]}>
          {t('settings.language')}
        </Text>
        <Text
          style={[
            styles.subsectionHint,
            isDark && settingsStyles.textSecondary,
            { flex: 0, marginTop: 0, marginBottom: 0 },
          ]}
        >
          {currentLanguageLabel}
        </Text>
      </View>
      <LanguageList language={language} onSelect={onLanguageChange} />
    </>
  );

  return (
    <>
      <ListSectionHeader>{t('settings.display')}</ListSectionHeader>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {displayContent}

        <View style={[styles.divider, isDark && styles.dividerDark]} />
        <View style={styles.subsectionHeader}>
          <MaterialCommunityIcons
            name="run"
            size={iconSize.md}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.subsectionLabel, isDark && settingsStyles.textSecondary]}>
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
        <Text style={[styles.embeddedHint, isDark && settingsStyles.textSecondary]}>
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
    paddingBottom: spacing.xs,
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
  embeddedHint: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    fontStyle: 'italic',
  },
});
