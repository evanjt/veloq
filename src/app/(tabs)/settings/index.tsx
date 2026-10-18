import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Image, type ScrollViewInstance } from 'react-native';
import {
  canDrawProfilePhoto,
  ListSectionHeader,
  Row,
  RowGroup,
  ScreenSafeAreaView,
  ScreenScrollView,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import { useScrollToTopOnReselect } from '@/shared/ui/tabReselect';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useAthlete } from '@/shared/app/useAthlete';
import { useAuthStore } from '@/shared/app/AuthStore';
import { SCHEME_LABEL_KEY, sourceFor, type AuthMethod } from '@/shared/app/source';
import { useRouteSettings } from '@/features/routes';
import { useRecordingPreferences } from '@/features/recording';
import { useSensorStore } from '@/features/sensors';
import {
  useLastBackupTimestamp,
  useAutoBackupEnabled,
  useNotificationPreferences,
  SettingsNavRow,
  RecordingPermissionSection,
  FooterSection,
  SupportSection,
  settingsStyles,
  useMapPreferences,
  useDashboardPreferences,
} from '@/features/settings';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useLanguageStore, languageLabel } from '@/shared/app/LanguageStore';
import { useThemePreferenceStore } from '@/shared/app/ThemeProvider';
import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { navigateTo } from '@/shared/app/navigation';
import { SCREEN_HEADERS, headerTitleOf } from '@/shared/app/screenHeaders';
import { formatFileSize, formatMonthYear, getIntlLocale } from '@/shared/format/format';
import { getAppStorageSize } from '@/shared/storage/gpsStorage';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { NameText } from '@/shared/ui/NameText';

interface AccountRowProps {
  athlete?: { name?: string; profile?: string; profile_medium?: string } | undefined;
  authMethod: AuthMethod;
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

  const badgeLabel = t(SCHEME_LABEL_KEY[sourceFor({ authMethod })?.scheme ?? 'demo']);

  return (
    <View
      style={[
        settingsStyles.sectionCard,
        isDark && settingsStyles.sectionCardDark,
        styles.accountCard,
      ]}
    >
      <Row
        testID="settings-account-row"
        behaviour="navigate"
        accessibilityLabel={athlete?.name || t('settings.account')}
        onPress={() => navigateTo('/account')}
      >
        <View style={[styles.accountPhoto, isDark && styles.accountPhotoDark]}>
          {canDrawProfilePhoto(profileUrl, profileImageError) ? (
            <Image
              accessibilityIgnoresInvertColors
              source={{ uri: profileUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={onProfileImageError}
            />
          ) : (
            <Icon
              name="account"
              size={iconSize.lg}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          )}
        </View>
        <View style={styles.accountInfo}>
          <NameText style={[styles.accountName, isDark && settingsStyles.textLight]}>
            {athlete?.name || t('settings.account')}
          </NameText>
          <Text style={[styles.accountBadge, isDark && settingsStyles.textSecondary]}>
            {badgeLabel}
          </Text>
        </View>
      </Row>
    </View>
  );
}

interface SpokeRowProps {
  /** The root-stack route the row opens, which is also where its title comes from. */
  route: string;
  icon: React.ComponentProps<typeof SettingsNavRow>['icon'];
  subtitle?: string | undefined;
  testID: string;
}

/**
 * A hub row titled from the header of the screen it opens, so the row and the
 * screen cannot carry two names for one place.
 */
function SpokeRow({ route, icon, subtitle, testID }: SpokeRowProps) {
  const { t } = useTranslation();
  return (
    <SettingsNavRow
      icon={icon}
      title={headerTitleOf(SCREEN_HEADERS[route], t)}
      subtitle={subtitle}
      onPress={() => navigateTo(`/${route}`)}
      testID={testID}
    />
  );
}

function SettingsScreenContent() {
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('SettingsScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  useTabFirstFrame('/settings');
  const scrollRef = useRef<ScrollViewInstance>(null);
  useScrollToTopOnReselect('/settings', scrollRef);

  const { t } = useTranslation();
  const { isDark } = useTheme();

  const { data: athleteRow } = useAthlete();
  const athlete = athleteRow ?? undefined;
  const authMethod = useAuthStore((state) => state.authMethod);
  const [profileImageError, setProfileImageError] = useState(false);

  // Subtitle: Display
  const themePreference = useThemePreferenceStore((s) => s.preference);
  const unitPreference = useUnitPreference((s) => s.unitPreference);
  const language = useLanguageStore((s) => s.language);

  const currentLanguageLabel = languageLabel(language).label;

  const unitLabel =
    unitPreference === 'auto'
      ? t('settings.unitsAuto')
      : unitPreference === 'metric'
        ? t('settings.unitsMetric')
        : t('settings.unitsImperial');
  const displaySubtitle = useMemo(
    () =>
      [t(`settings.${themePreference}` as never), unitLabel, currentLanguageLabel]
        .filter(Boolean)
        .join(', '),
    [t, themePreference, unitLabel, currentLanguageLabel]
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
    const label = formatMonthYear(oldest);
    return t('settings.sinceDateSubtitle', {
      defaultValue: `Since ${label}`,
      date: label,
    });
  }, [oldest, t]);

  // Subtitle: Routes & sections
  const routeMatchingEnabled = useRouteSettings((s) => s.settings.enabled);
  const detectionSubtitle = useMemo(
    () => (routeMatchingEnabled ? t('common.on') : t('common.off')),
    [routeMatchingEnabled, t]
  );

  // Subtitle: Recording. GPS accuracy is the preference that decides what the
  // recorder captures, so it is the one worth previewing on the row.
  const gpsAccuracyMode = useRecordingPreferences((s) => s.gpsAccuracyMode);
  const recordingSubtitle = t(`recording.gpsModes.${gpsAccuracyMode}` as never);

  // Subtitle: Sensors
  const pairedSensorCount = useSensorStore((s) => s.knownSensors.length);
  const sensorsSubtitle =
    pairedSensorCount > 0
      ? t('sensors.pairedCount', { count: pairedSensorCount })
      : t('sensors.nonePairedShort');

  // Subtitle: Notifications
  const notificationsEnabled = useNotificationPreferences((s) => s.enabled);

  // Subtitle: Backup. The spoke's main preference is the automatic backup
  // switch, so a date shows only while it is on. A manual run also writes the
  // date and would otherwise make a switched-off row read as running.
  const autoBackupEnabled = useAutoBackupEnabled();
  const lastBackupTimestamp = useLastBackupTimestamp();
  const lastBackupText = !autoBackupEnabled
    ? t('common.off')
    : lastBackupTimestamp
      ? new Date(lastBackupTimestamp).toLocaleDateString(getIntlLocale())
      : t('backup.lastBackupNever');

  // Subtitle: Cache
  const [totalCacheSize, setTotalCacheSize] = useState(0);
  useEffect(() => {
    getAppStorageSize().then(setTotalCacheSize);
  }, []);

  return (
    <ScreenSafeAreaView
      testID="settings-screen"
      style={[styles.container, isDark && styles.containerDark]}
    >
      <ScreenScrollView
        ref={scrollRef}
        testID="settings-scrollview"
        contentContainerStyle={{ paddingBottom: spacing.xl }}
      >
        {/* Account */}
        <AccountRow
          athlete={athlete}
          authMethod={authMethod}
          profileImageError={profileImageError}
          onProfileImageError={() => setProfileImageError(true)}
          isDark={isDark}
        />

        <RecordingPermissionSection />

        {/* Grouped by what the athlete is doing, not by which subsystem owns
              the screen: that is how the heatmap toggle came to sit under sync. */}
        <ListSectionHeader testID="settings-group-shows">
          {t('settings.groupShows', 'Appearance')}
        </ListSectionHeader>
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <RowGroup>
            <SpokeRow
              route="display-settings"
              icon="palette-outline"
              subtitle={displaySubtitle}
              testID="settings-nav-display"
            />
            <SpokeRow
              route="map-settings"
              icon="map"
              subtitle={mapsSubtitle}
              testID="settings-nav-maps"
            />
            <SpokeRow
              route="summary-card-settings"
              icon="card-text-outline"
              subtitle={summaryCardEnabled ? t('common.on') : t('common.off')}
              testID="settings-nav-summary-card"
            />
          </RowGroup>
        </View>

        {/* Notifications report on the activities a sync brings in, and data
              sources name where those activities come from. */}
        <ListSectionHeader testID="settings-group-collects">
          {t('settings.groupCollects', 'Data & recording')}
        </ListSectionHeader>
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <RowGroup>
            <SpokeRow
              route="sync-settings"
              icon="sync"
              subtitle={syncSubtitle}
              testID="settings-nav-sync"
            />
            <SpokeRow
              route="recording-settings"
              icon="record-circle-outline"
              subtitle={recordingSubtitle}
              testID="settings-nav-recording"
            />
            <SpokeRow
              route="sensor-settings"
              icon="bluetooth"
              subtitle={sensorsSubtitle}
              testID="settings-nav-sensors"
            />
            <SpokeRow
              route="notification-settings"
              icon="bell-outline"
              subtitle={notificationsEnabled ? t('common.on') : t('common.off')}
              testID="settings-nav-notifications"
            />
            <SpokeRow
              route="data-sources-settings"
              icon="link-variant"
              testID="settings-nav-data-sources"
            />
          </RowGroup>
        </View>

        {/* Detection is a computation, but what the athlete manages on that
              screen is the catalogue it keeps, so it sits here. */}
        <ListSectionHeader testID="settings-group-keeps">
          {t('settings.groupKeeps', 'Library & backup')}
        </ListSectionHeader>
        <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
          <RowGroup>
            <SpokeRow
              route="detection-settings"
              icon="map-marker-path"
              subtitle={detectionSubtitle}
              testID="settings-nav-detection"
            />
            <SpokeRow
              route="backup-settings"
              icon="cloud-sync-outline"
              subtitle={lastBackupText}
              testID="settings-nav-backup"
            />
            <SpokeRow
              route="cache-settings"
              icon="database-outline"
              subtitle={formatFileSize(totalCacheSize)}
              testID="settings-nav-cache"
            />
          </RowGroup>
        </View>

        <SupportSection />

        <FooterSection />
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfacePage,
  },
  containerDark: {
    backgroundColor: darkColors.surfacePage,
  },
  accountCard: {
    marginTop: spacing.md,
    marginHorizontal: layout.screenPadding,
  },
  accountPhoto: {
    width: 36,
    height: 36,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.surfacePage,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  accountPhotoDark: {
    backgroundColor: darkColors.surfaceRaised,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  accountBadge: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
});

export default withScreenBoundary(SettingsScreenContent, 'Settings');
