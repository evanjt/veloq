import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  LayoutChangeEvent,
} from 'react-native';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAthlete, useTheme } from '@/hooks';
import {
  getThemePreference,
  setThemePreference,
  useSportPreference,
  useLanguageStore,
  useUnitPreference,
  type ThemePreference,
  type PrimarySport,
  type UnitPreference,
} from '@/providers';
import { colors, darkColors, spacing, layout } from '@/theme';
import {
  ProfileSection,
  DisplaySettings,
  MapsSection,
  SummaryCardSection,
  DataCacheSection,
  AccountSection,
  DataSourcesSection,
  SupportSection,
} from '@/components/settings';

export default function SettingsScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('SettingsScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [showLanguages, setShowLanguages] = useState(false);

  // Scroll-to-anchor support
  const { scrollTo } = useLocalSearchParams<{ scrollTo?: string }>();
  const scrollViewRef = useRef<ScrollView>(null);
  const dataCacheSectionY = useRef<number>(0);
  const hasScrolled = useRef(false);

  // Track data cache section position
  const handleDataCacheSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      dataCacheSectionY.current = event.nativeEvent.layout.y;
      // Scroll if we haven't yet and have a scroll target
      if (scrollTo === 'cache' && !hasScrolled.current && scrollViewRef.current) {
        hasScrolled.current = true;
        // Small delay to ensure layout is complete
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({
            y: dataCacheSectionY.current - 16,
            animated: true,
          });
        }, 100);
      }
    },
    [scrollTo]
  );

  const { data: athlete } = useAthlete();
  const primarySport = useSportPreference((s) => s.primarySport);
  const setPrimarySport = useSportPreference((s) => s.setPrimarySport);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const unitPreference = useUnitPreference((s) => s.unitPreference);
  const setUnitPreference = useUnitPreference((s) => s.setUnitPreference);
  const intervalsPreferences = useUnitPreference((s) => s.intervalsPreferences);

  // Load saved theme preference on mount
  useEffect(() => {
    getThemePreference()
      .then(setThemePreferenceState)
      .catch(() => {
        // Default to system preference on error
        setThemePreferenceState('system');
      });
  }, []);

  const handleThemeChange = async (value: string) => {
    const preference = value as ThemePreference;
    setThemePreferenceState(preference);
    await setThemePreference(preference);
  };

  const handleSportChange = async (value: string) => {
    await setPrimarySport(value as PrimarySport);
  };

  const handleLanguageChange = async (value: string) => {
    await setLanguage(value);
  };

  const handleUnitChange = async (value: string) => {
    await setUnitPreference(value as UnitPreference);
  };

  return (
    <ScreenSafeAreaView
      testID="settings-screen"
      style={[styles.container, isDark && styles.containerDark]}
    >
      <ScrollView
        testID="settings-scrollview"
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
      >
        {/* Header with back button */}
        <View style={styles.header}>
          <TouchableOpacity
            testID="nav-back-button"
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
            {t('settings.title')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Profile Section - tap to open intervals.icu profile */}
        <View style={{ marginHorizontal: layout.screenPadding }}>
          <ProfileSection athlete={athlete} />
        </View>

        <SummaryCardSection />

        {/* Display Settings: Appearance, Units, Language, Primary Sport */}
        <DisplaySettings
          themePreference={themePreference}
          onThemeChange={handleThemeChange}
          unitPreference={unitPreference}
          onUnitChange={handleUnitChange}
          intervalsUnitPreference={intervalsPreferences}
          primarySport={primarySport}
          onSportChange={handleSportChange}
          language={language ?? 'en-GB'}
          onLanguageChange={handleLanguageChange}
          showLanguages={showLanguages}
          setShowLanguages={setShowLanguages}
        />

        <MapsSection />

        <DataCacheSection onLayout={handleDataCacheSectionLayout} />

        <AccountSection />

        <DataSourcesSection />

        <SupportSection />
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
