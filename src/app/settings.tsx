import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { ScreenSafeAreaView, ScreenErrorBoundary, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAthlete, useTheme } from '@/hooks';
import {
  useThemePreferenceStore,
  useSportPreference,
  useLanguageStore,
  useUnitPreference,
  useAuthStore,
  useMapPreferences,
  useDashboardPreferences,
  useNotificationPreferences,
  useRouteSettings,
  useSyncDateRange,
  getAvailableLanguages,
} from '@/providers';
import { navigateTo, formatFileSize, getAppStorageSize } from '@/lib';
import { getLastBackupTimestamp } from '@/lib/backup';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { SettingsNavRow } from '@/components/settings/SettingsNavRow';
import { FooterSection, SupportSection } from '@/components/settings';
import { settingsStyles, DIVIDER_INSET } from '@/components/settings/settingsStyles';

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

function RowDivider({ isDark }: { isDark: boolean }) {
  return <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />;
}

export default function SettingsScreen() {
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('SettingsScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();

  const { data: athlete } = useAthlete();
  const authMethod = useAuthStore((state) => state.authMethod);
  const [profileImageError, setProfileImageError] = useState(false);

  // Subtitle: Display
  const themePreference = useThemePreferenceStore((s) => s.preference);
  const unitPreference = useUnitPreference((s) => s.unitPreference);
  const language = useLanguageStore((s) => s.language);

  const languageLabel = useMemo(() => {
    for (const group of getAvailableLanguages()) {
      for (const lang of group.languages) {
        if (language === lang.value) return lang.label;
        if (lang.variants) {
          const v = lang.variants.find((variant) => variant.value === language);
          if (v) return v.label;
        }
      }
    }
    return language ?? 'English';
  }, [language]);

  const unitLabel =
    unitPreference === 'auto'
      ? t('settings.unitsAuto')
      : unitPreference === 'metric'
        ? t('settings.unitsMetric')
        : t('settings.unitsImperial');
  const displaySubtitle = useMemo(
    () =>
      [t(`settings.${themePreference}` as never), unitLabel, languageLabel]
        .filter(Boolean)
        .join(', '),
    [t, themePreference, unitLabel, languageLabel]
  );

  // Subtitle: Maps
  const { preferences: mapPreferences } = useMapPreferences();
  const mapsSubtitle = useMemo(
    () =>
      `${t(`settings.${mapPreferences.defaultStyle}` as never)}, 3D: ${t(`settings.terrain3D${mapPreferences.terrain3DMode.charAt(0).toUpperCase()}${mapPreferences.terrain3DMode.slice(1)}` as never)}`,
    [t, mapPreferences.defaultStyle, mapPreferences.terrain3DMode]
  );

  // Subtitle: Summary Card
  const summaryCardEnabled = useDashboardPreferences((s) => s.summaryCard.enabled);

  // Subtitle: Local Data Range
  const oldest = useSyncDateRange((s) => s.oldest);
  const syncSubtitle = useMemo(() => {
    if (!oldest) return '';
    const d = new Date(oldest);
    return t('settings.sinceDateSubtitle', {
      defaultValue: `Since ${d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`,
      date: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
    });
  }, [oldest, t]);

  // Subtitle: Routes & Sections
  const routeMatchingEnabled = useRouteSettings((s) => s.settings.enabled);
  const detectionMethod = useRouteSettings((s) => s.settings.detectionMethod);
  const detectionSubtitle = useMemo(() => {
    if (!routeMatchingEnabled) return t('common.off');
    return t(`settings.detectionMethod_${detectionMethod}` as never) as string;
  }, [routeMatchingEnabled, detectionMethod, t]);

  // Subtitle: Notifications
  const notificationsEnabled = useNotificationPreferences((s) => s.enabled);

  // Subtitle: Backup
  const lastBackupText = useMemo(() => {
    const ts = getLastBackupTimestamp();
    if (!ts) return t('backup.lastBackupNever');
    return new Date(ts).toLocaleDateString();
  }, [t]);

  // Subtitle: Cache
  const [totalCacheSize, setTotalCacheSize] = useState(0);
  useEffect(() => {
    getAppStorageSize().then(setTotalCacheSize);
  }, []);

  const nav = useCallback((path: string) => () => navigateTo(path), []);

  return (
    <ScreenErrorBoundary screenName="Settings">
      <ScreenSafeAreaView
        testID="settings-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <ScrollView testID="settings-scrollview" contentContainerStyle={styles.content}>
          {/* Header */}
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

          {/* Account */}
          <AccountRow
            athlete={athlete}
            authMethod={authMethod}
            profileImageError={profileImageError}
            onProfileImageError={() => setProfileImageError(true)}
            isDark={isDark}
          />

          {/* General */}
          <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
            {t('settings.general', 'GENERAL').toUpperCase()}
          </Text>
          <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
            <SettingsNavRow
              icon="palette-outline"
              title={t('settings.display')}
              subtitle={displaySubtitle}
              onPress={nav('/display-settings')}
              testID="settings-nav-display"
            />
            <RowDivider isDark={isDark} />
            <SettingsNavRow
              icon="map"
              title={t('settings.maps')}
              subtitle={mapsSubtitle}
              onPress={nav('/map-settings')}
              testID="settings-nav-maps"
            />
            <RowDivider isDark={isDark} />
            <SettingsNavRow
              icon="card-text-outline"
              title={t('settings.summaryCard')}
              subtitle={summaryCardEnabled ? t('common.on') : t('common.off')}
              onPress={nav('/summary-card-settings')}
              testID="settings-nav-summary-card"
            />
          </View>

          {/* Data */}
          <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
            {t('settings.data', 'DATA').toUpperCase()}
          </Text>
          <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
            <SettingsNavRow
              icon="sync"
              title={t('settings.localDataRange', 'Local Data Range')}
              subtitle={syncSubtitle}
              onPress={nav('/sync-settings')}
              testID="settings-nav-sync"
            />
            <RowDivider isDark={isDark} />
            <SettingsNavRow
              icon="map-marker-path"
              title={t('settings.routesAndSections', 'Routes & Sections')}
              subtitle={detectionSubtitle}
              onPress={nav('/detection-settings')}
              testID="settings-nav-detection"
            />
          </View>

          {/* Notifications & Storage */}
          <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
            {t('settings.notificationsAndStorage', 'NOTIFICATIONS & STORAGE').toUpperCase()}
          </Text>
          <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
            <SettingsNavRow
              icon="bell-outline"
              title={t('notifications.settings.title')}
              subtitle={notificationsEnabled ? t('common.on') : t('common.off')}
              onPress={nav('/notification-settings')}
              testID="settings-nav-notifications"
            />
            <RowDivider isDark={isDark} />
            <SettingsNavRow
              icon="cloud-sync-outline"
              title={t('backup.autoBackup')}
              subtitle={lastBackupText}
              onPress={nav('/backup-settings')}
              testID="settings-nav-backup"
            />
            <RowDivider isDark={isDark} />
            <SettingsNavRow
              icon="database-outline"
              title={t('settings.cacheAndDatabase', 'Cache & Storage')}
              subtitle={formatFileSize(totalCacheSize)}
              onPress={nav('/cache-settings')}
              testID="settings-nav-cache"
            />
          </View>

          {/* Support inline */}
          <SupportSection />

          {/* Data sources */}
          <View style={styles.footerArea}>
            <SettingsNavRow
              icon="link-variant"
              title={t('settings.dataSources')}
              onPress={nav('/data-sources-settings')}
              testID="settings-nav-data-sources"
            />
          </View>

          <FooterSection />
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
  footerArea: {
    marginTop: spacing.lg,
    marginHorizontal: layout.screenPadding,
  },
});
