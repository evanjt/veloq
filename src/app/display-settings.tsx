import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { useSportPreference, type PrimarySport } from '@/features/fitness';
import { useLanguageStore } from '@/shared/app/LanguageStore';
import {
  setThemePreference,
  useThemePreferenceStore,
  type ThemePreference,
} from '@/shared/app/ThemeProvider';
import { useUnitPreference, type UnitPreference } from '@/shared/app/UnitPreferenceStore';
import { colors, darkColors, spacing } from '@/theme';
import { DisplaySettings } from '@/features/settings/components';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function DisplaySettingsScreenContent() {
  const { isDark } = useTheme();
  const themePreference = useThemePreferenceStore((s) => s.preference);
  const primarySport = useSportPreference((s) => s.primarySport);
  const setPrimarySport = useSportPreference((s) => s.setPrimarySport);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const unitPreference = useUnitPreference((s) => s.unitPreference);
  const setUnitPreference = useUnitPreference((s) => s.setUnitPreference);
  const intervalsPreferences = useUnitPreference((s) => s.intervalsPreferences);

  return (
    <ScreenSafeAreaView hasNativeHeader style={[styles.container, isDark && styles.containerDark]}>
      <ScrollView contentContainerStyle={styles.content}>
        <DisplaySettings
          themePreference={themePreference}
          onThemeChange={(v) => setThemePreference(v as ThemePreference)}
          unitPreference={unitPreference}
          onUnitChange={(v) => setUnitPreference(v as UnitPreference)}
          intervalsUnitPreference={intervalsPreferences}
          primarySport={primarySport}
          onSportChange={(v) => setPrimarySport(v as PrimarySport)}
          language={language ?? 'en-GB'}
          onLanguageChange={(v) => setLanguage(v)}
        />
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  content: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
});

export default withScreenBoundary(DisplaySettingsScreenContent, 'DisplaySettings');
