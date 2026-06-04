import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { ScreenSafeAreaView, ScreenErrorBoundary, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import {
  setThemePreference,
  useThemePreferenceStore,
  useSportPreference,
  useLanguageStore,
  useUnitPreference,
  type ThemePreference,
  type PrimarySport,
  type UnitPreference,
} from '@/providers';
import { colors, darkColors, spacing, layout } from '@/theme';
import { DisplaySettings } from '@/components/settings';

export default function DisplaySettingsScreen() {
  const { t } = useTranslation();
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
    <ScreenErrorBoundary screenName="DisplaySettings">
      <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backButton}
              accessibilityLabel={t('common.back')}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons
                name="arrow-left"
                size={24}
                color={isDark ? colors.textOnDark : colors.textPrimary}
              />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, isDark && styles.textLight]}>
              {t('settings.display')}
            </Text>
            <View style={styles.headerSpacer} />
          </View>

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
    </ScreenErrorBoundary>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.md,
  },
  backButton: {
    padding: spacing.xs,
    marginLeft: -spacing.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 32,
  },
  textLight: {
    color: colors.textOnDark,
  },
});
