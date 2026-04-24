import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  type LayoutChangeEvent,
} from 'react-native';
import { ScreenSafeAreaView, ScreenErrorBoundary, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAthlete, useTheme } from '@/hooks';
import {
  setThemePreference,
  useThemePreferenceStore,
  useSportPreference,
  useLanguageStore,
  useUnitPreference,
  useAuthStore,
  type ThemePreference,
  type PrimarySport,
  type UnitPreference,
} from '@/providers';
import { navigateTo } from '@/lib';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import {
  DisplaySettings,
  MapsSection,
  SummaryCardSection,
  DataSection,
  DataSourcesSection,
  NotificationSection,
  SectionDetectionSection,
  SupportSection,
  SyncRangePanel,
} from '@/components/settings';
import { settingsStyles } from '@/components/settings/settingsStyles';

interface AccountRowProps {
  athlete?: { name?: string; profile?: string; profile_medium?: string };
  authMethod: string | null;
  profileImageError: boolean;
  onProfileImageError: () => void;
  isDark: boolean;
}

function AccountRow({
  athlete,
  authMethod,
  profileImageError,
  onProfileImageError,
  isDark,
}: AccountRowProps) {
  const { t } = useTranslation();
  const profileUrl = athlete?.profile_medium || athlete?.profile;
  const hasValidProfileUrl =
    profileUrl && typeof profileUrl === 'string' && profileUrl.startsWith('http');

  const badgeLabel =
    authMethod === 'oauth' ? 'OAuth' : authMethod === 'apiKey' ? 'API key' : 'Demo';

  return (
    <View
      style={[
        settingsStyles.sectionCard,
        isDark && settingsStyles.sectionCardDark,
        styles.accountCard,
      ]}
    >
      <TouchableOpacity
        testID="settings-account-row"
        style={styles.accountRow}
        onPress={() => navigateTo('/account')}
        activeOpacity={0.7}
      >
        <View style={[styles.accountPhoto, isDark && styles.accountPhotoDark]}>
          {hasValidProfileUrl && !profileImageError ? (
            <Image
              source={{ uri: profileUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={onProfileImageError}
            />
          ) : (
            <MaterialCommunityIcons
              name="account"
              size={22}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          )}
        </View>
        <View style={styles.accountInfo}>
          <Text style={[styles.accountName, isDark && settingsStyles.textLight]} numberOfLines={1}>
            {athlete?.name || t('settings.account')}
          </Text>
          <Text style={[styles.accountBadge, isDark && settingsStyles.textMuted]}>
            {badgeLabel}
          </Text>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? darkColors.textMuted : colors.textSecondary}
        />
      </TouchableOpacity>
    </View>
  );
}

export default function SettingsScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('SettingsScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const themePreference = useThemePreferenceStore((s) => s.preference);
  const [showLanguages, setShowLanguages] = useState(false);

  // Optional deep-link to a specific section (e.g. ?scrollTo=syncRange).
  const { scrollTo } = useLocalSearchParams<{ scrollTo?: string }>();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const syncRangeOffsetRef = useRef<number | null>(null);
  const handleSyncRangeLayout = (event: LayoutChangeEvent) => {
    syncRangeOffsetRef.current = event.nativeEvent.layout.y;
    if (scrollTo === 'syncRange' && scrollViewRef.current) {
      // Defer one tick so the ScrollView has been measured.
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollTo({
          y: Math.max(0, (syncRangeOffsetRef.current ?? 0) - 16),
          animated: true,
        });
      });
    }
  };

  const { data: athlete } = useAthlete();
  const authMethod = useAuthStore((state) => state.authMethod);
  const [profileImageError, setProfileImageError] = useState(false);
  const primarySport = useSportPreference((s) => s.primarySport);
  const setPrimarySport = useSportPreference((s) => s.setPrimarySport);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const unitPreference = useUnitPreference((s) => s.unitPreference);
  const setUnitPreference = useUnitPreference((s) => s.setUnitPreference);
  const intervalsPreferences = useUnitPreference((s) => s.intervalsPreferences);

  const handleThemeChange = async (value: string) => {
    const preference = value as ThemePreference;
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
    <ScreenErrorBoundary screenName="Settings">
      <ScreenSafeAreaView
        testID="settings-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <ScrollView
          ref={scrollViewRef}
          testID="settings-scrollview"
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

          {/* Account navigation row */}
          <AccountRow
            athlete={athlete}
            authMethod={authMethod}
            profileImageError={profileImageError}
            onProfileImageError={() => setProfileImageError(true)}
            isDark={isDark}
          />

          <View onLayout={handleSyncRangeLayout}>
            <SyncRangePanel />
          </View>

          <SummaryCardSection />

          {/* Display & Maps — merged section */}
          <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
            {t('settings.displayAndMaps').toUpperCase()}
          </Text>
          <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
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
              embedded
            />
            <View style={styles.sectionDivider}>
              <View style={[styles.sectionDividerLine, isDark && styles.sectionDividerLineDark]} />
            </View>
            <MapsSection embedded />
          </View>

          <NotificationSection />

          <DataSection />
          <SectionDetectionSection />

          <DataSourcesSection />

          <SupportSection />
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
  accountCard: {
    marginTop: spacing.md,
    marginHorizontal: layout.screenPadding,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: layout.minTapTarget,
  },
  accountPhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  accountPhotoDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    ...typography.body,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  accountBadge: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
  sectionDivider: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sectionDividerLine: {
    height: 1,
    backgroundColor: colors.border,
  },
  sectionDividerLineDark: {
    backgroundColor: darkColors.border,
  },
});
