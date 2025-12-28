import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useColorScheme,
  Image,
  Alert,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SegmentedButtons, Switch } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAthlete, useActivityBoundsCache, useRouteProcessing, useRouteGroups, useActivities } from '@/hooks';
import { getAthleteId } from '@/api';
import { estimateBoundsCacheSize, estimateGpsStorageSize } from '@/lib';
import {
  getThemePreference,
  setThemePreference,
  useMapPreferences,
  useAuthStore,
  useSportPreference,
  useRouteSettings,
  useLanguageStore,
  getAvailableLanguages,
  type ThemePreference,
  type PrimarySport,
} from '@/providers';
import { type SupportedLocale } from '@/i18n';
import { type MapStyleType } from '@/components/maps';
import { colors, spacing, layout } from '@/theme';
import type { ActivityType } from '@/types';

// Activity type groups for map settings
// Each group applies the same map style to all its activity types
// Covers ALL ActivityType values from types/activity.ts
const MAP_ACTIVITY_GROUPS: { key: string; labelKey: string; types: ActivityType[] }[] = [
  { key: 'cycling', labelKey: 'filters.cycling', types: ['Ride', 'VirtualRide'] },
  { key: 'running', labelKey: 'filters.running', types: ['Run', 'TrailRun', 'VirtualRun'] },
  { key: 'hiking', labelKey: 'filters.hiking', types: ['Hike', 'Snowshoe'] },
  { key: 'walking', labelKey: 'filters.walking', types: ['Walk'] },
  { key: 'swimming', labelKey: 'filters.swimming', types: ['Swim', 'OpenWaterSwim'] },
  { key: 'snow', labelKey: 'filters.snowSports', types: ['AlpineSki', 'NordicSki', 'BackcountrySki', 'Snowboard'] },
  { key: 'water', labelKey: 'filters.waterSports', types: ['Rowing', 'Kayaking', 'Canoeing'] },
  { key: 'climbing', labelKey: 'filters.climbing', types: ['RockClimbing'] },
  { key: 'racket', labelKey: 'filters.racketSports', types: ['Tennis'] },
  { key: 'other', labelKey: 'filters.other', types: ['Workout', 'WeightTraining', 'Yoga', 'Other'] },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [profileImageError, setProfileImageError] = useState(false);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [showActivityStyles, setShowActivityStyles] = useState(false);

  const { data: athlete } = useAthlete();
  const { preferences: mapPreferences, setDefaultStyle, setActivityGroupStyle } = useMapPreferences();
  const clearCredentials = useAuthStore((state) => state.clearCredentials);
  const { primarySport, setPrimarySport } = useSportPreference();
  const { language, setLanguage } = useLanguageStore();
  const availableLanguages = getAvailableLanguages();

  // Load saved theme preference on mount
  useEffect(() => {
    getThemePreference().then(setThemePreferenceState);
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
    const locale = value === 'system' ? null : (value as SupportedLocale);
    await setLanguage(locale);
  };

  const handleDefaultMapStyleChange = async (value: string) => {
    const style = value as MapStyleType;
    await setDefaultStyle(style);
  };

  const handleActivityGroupMapStyleChange = async (groupKey: string, value: string) => {
    const group = MAP_ACTIVITY_GROUPS.find(g => g.key === groupKey);
    if (!group) return;

    const style = value === 'default' ? null : (value as MapStyleType);
    await setActivityGroupStyle(group.types, style);
  };

  // Fetch activities to get date range for cache stats
  const { data: allActivities } = useActivities({ days: 365 * 10, includeStats: false });

  const {
    progress,
    cacheStats,
    clearCache,
    syncAllHistory,
    sync90Days,
  } = useActivityBoundsCache({ activitiesWithDates: allActivities });

  // Route matching cache
  const { progress: routeProgress, isProcessing: isRouteProcessing, clearCache: clearRouteCache, cancel: cancelRouteProcessing } = useRouteProcessing();
  // Use minActivities: 2 to show actual routes (groups with 2+ activities), not signatures
  const { groups: routeGroups, processedCount: routeProcessedCount } = useRouteGroups({ minActivities: 2 });

  // Route matching settings
  const { settings: routeSettings, setEnabled: setRouteMatchingEnabled } = useRouteSettings();

  // Cache sizes state
  const [cacheSizes, setCacheSizes] = useState<{
    bounds: number;
    gps: number;
    routes: number;
  }>({ bounds: 0, gps: 0, routes: 0 });

  // Fetch cache sizes on mount and when caches change
  const refreshCacheSizes = useCallback(async () => {
    const [bounds, gps] = await Promise.all([
      estimateBoundsCacheSize(),
      estimateGpsStorageSize(),
    ]);
    // Routes cache is now in Rust SQLite, size estimation not available
    setCacheSizes({ bounds, gps, routes: 0 });
  }, []);

  useEffect(() => {
    refreshCacheSizes();
  }, [refreshCacheSizes, cacheStats.totalActivities, routeProcessedCount]);

  const profileUrl = athlete?.profile_medium || athlete?.profile;
  const hasValidProfileUrl = profileUrl && typeof profileUrl === 'string' && profileUrl.startsWith('http');

  const handleClearCache = () => {
    Alert.alert(
      t('alerts.clearCacheTitle'),
      t('alerts.clearCacheMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('alerts.clearReload'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Clear both map cache and route cache together
              await clearCache();
              await clearRouteCache();
              // Actively refetch activities for last 90 days (awaited)
              await sync90Days();
              // Refresh cache sizes
              refreshCacheSizes();
            } catch {
              Alert.alert(t('alerts.error'), t('alerts.failedToClear'));
            }
          },
        },
      ]
    );
  };

  const handleClearRouteCache = () => {
    Alert.alert(
      t('alerts.clearRouteCacheTitle'),
      t('alerts.clearRouteCacheMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('alerts.clearReload'),
          style: 'destructive',
          onPress: async () => {
            try {
              await clearRouteCache();
              // Cache cleared via Rust engine
              refreshCacheSizes();
            } catch {
              Alert.alert(t('alerts.error'), t('alerts.failedToClear'));
            }
          },
        },
      ]
    );
  };

  const handleSyncAll = () => {
    if (progress.status === 'syncing') {
      Alert.alert(t('settings.syncInProgress'), t('settings.syncInProgress'));
      return;
    }

    Alert.alert(
      t('alerts.syncAllTitle'),
      t('alerts.syncAllMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('alerts.sync'),
          onPress: syncAllHistory,
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      t('alerts.disconnectTitle'),
      t('alerts.disconnectMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('alerts.disconnect'),
          style: 'destructive',
          onPress: async () => {
            try {
              await clearCredentials();
              router.replace('/login' as Href);
            } catch {
              Alert.alert(t('alerts.error'), t('alerts.failedToDisconnect'));
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header with back button */}
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
              color={isDark ? '#FFF' : colors.textPrimary}
            />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>{t('settings.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Profile Section - tap to open intervals.icu profile */}
        <TouchableOpacity
          style={[styles.section, isDark && styles.sectionDark]}
          onPress={() => WebBrowser.openBrowserAsync(`https://intervals.icu/athlete/${getAthleteId()}/activities`)}
          activeOpacity={0.7}
        >
          <View style={styles.profileRow}>
            <View style={[styles.profilePhoto, isDark && styles.profilePhotoDark]}>
              {hasValidProfileUrl && !profileImageError ? (
                <Image
                  source={{ uri: profileUrl }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                  onError={() => setProfileImageError(true)}
                />
              ) : (
                <MaterialCommunityIcons
                  name="account"
                  size={32}
                  color={isDark ? '#AAA' : '#666'}
                />
              )}
            </View>
            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, isDark && styles.textLight]}>
                {athlete?.name || 'Athlete'}
              </Text>
              <Text style={[styles.profileEmail, isDark && styles.textMuted]}>
                intervals.icu
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={24}
              color={isDark ? '#666' : colors.textSecondary}
            />
          </View>
        </TouchableOpacity>

        {/* Appearance Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.appearance').toUpperCase()}</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.themePickerContainer}>
            <SegmentedButtons
              value={themePreference}
              onValueChange={handleThemeChange}
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
          {availableLanguages.map((lang, index) => (
            <TouchableOpacity
              key={lang.value ?? 'system'}
              style={[
                styles.languageRow,
                index > 0 && styles.languageRowBorder,
                isDark && styles.languageRowDark,
              ]}
              onPress={() => handleLanguageChange(lang.value ?? 'system')}
            >
              <Text style={[styles.languageLabel, isDark && styles.textLight]}>
                {lang.label}
              </Text>
              {(language === lang.value || (language === null && lang.value === null)) && (
                <MaterialCommunityIcons
                  name="check"
                  size={20}
                  color={colors.primary}
                />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Primary Sport Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.primarySport').toUpperCase()}</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.themePickerContainer}>
            <SegmentedButtons
              value={primarySport}
              onValueChange={handleSportChange}
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
          {t('settings.primarySportHint')}
        </Text>


        {/* Maps Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.maps').toUpperCase()}</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.mapStyleRow}>
            <Text style={[styles.mapStyleLabel, isDark && styles.textLight]}>{t('settings.defaultStyle')}</Text>
          </View>
          <View style={styles.themePickerContainer}>
            <SegmentedButtons
              value={mapPreferences.defaultStyle}
              onValueChange={handleDefaultMapStyleChange}
              buttons={[
                {
                  value: 'light',
                  label: t('settings.light'),
                  icon: 'map',
                },
                {
                  value: 'dark',
                  label: t('settings.dark'),
                  icon: 'map',
                },
                {
                  value: 'satellite',
                  label: t('settings.satellite'),
                  icon: 'satellite-variant',
                },
              ]}
              style={styles.themePicker}
            />
          </View>

          {/* Per-activity-type styles toggle */}
          <TouchableOpacity
            style={[styles.actionRow, styles.actionRowBorder]}
            onPress={() => setShowActivityStyles(!showActivityStyles)}
          >
            <MaterialCommunityIcons
              name="tune-variant"
              size={22}
              color={colors.primary}
            />
            <Text style={[styles.actionText, isDark && styles.textLight]}>
              {t('settings.customiseByActivity')}
            </Text>
            <MaterialCommunityIcons
              name={showActivityStyles ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={isDark ? '#666' : colors.textSecondary}
            />
          </TouchableOpacity>

          {/* Per-activity-group pickers */}
          {showActivityStyles && (
            <View style={styles.activityStylesContainer}>
              {MAP_ACTIVITY_GROUPS.map(({ key, labelKey, types }) => {
                // Use the first type in the group to determine current style
                const currentStyle = mapPreferences.activityTypeStyles[types[0]] ?? 'default';
                return (
                  <View key={key} style={styles.activityStyleRow}>
                    <Text style={[styles.activityStyleLabel, isDark && styles.textLight]}>
                      {t(labelKey)}
                    </Text>
                    <SegmentedButtons
                      value={currentStyle}
                      onValueChange={(value) => handleActivityGroupMapStyleChange(key, value)}
                      buttons={[
                        { value: 'default', label: t('settings.default') },
                        { value: 'light', label: t('settings.light') },
                        { value: 'dark', label: t('settings.dark') },
                        { value: 'satellite', label: t('settings.satellite') },
                      ]}
                      density="small"
                      style={styles.activityStylePicker}
                    />
                  </View>
                );
              })}
              <Text style={[styles.activityStyleHint, isDark && styles.textMuted]}>
                {t('settings.defaultMapHint')}
              </Text>
            </View>
          )}
        </View>

        {/* Data Cache Section - Consolidated */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.dataCache').toUpperCase()}</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          {/* Sync Status Banners */}
          {progress.status === 'syncing' && (
            <View style={styles.syncBanner}>
              <MaterialCommunityIcons name="sync" size={18} color="#FFF" />
              <Text style={styles.syncBannerText}>
                {progress.message || `Syncing ${progress.completed}/${progress.total}`}
              </Text>
            </View>
          )}
          {isRouteProcessing && (
            <View style={[styles.syncBanner, { backgroundColor: colors.chartPurple }]}>
              <MaterialCommunityIcons name="map-marker-path" size={18} color="#FFF" />
              <Text style={styles.syncBannerText}>
                {routeProgress.message || `Analysing ${routeProgress.current}/${routeProgress.total}`}
              </Text>
            </View>
          )}

          {/* Actions */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleSyncAll}
            disabled={progress.status === 'syncing'}
          >
            <MaterialCommunityIcons
              name="sync"
              size={22}
              color={progress.status === 'syncing' ? colors.textSecondary : colors.primary}
            />
            <Text style={[
              styles.actionText,
              isDark && styles.textLight,
              progress.status === 'syncing' && styles.actionTextDisabled,
            ]}>
              {t('settings.syncAllHistory')}
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? '#666' : colors.textSecondary}
            />
          </TouchableOpacity>

          <View style={[styles.divider, isDark && styles.dividerDark]} />

          {routeSettings.enabled && (
            <>
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/routes' as Href)}
              >
                <MaterialCommunityIcons
                  name="map-marker-path"
                  size={22}
                  color={colors.primary}
                />
                <Text style={[styles.actionText, isDark && styles.textLight]}>
                  {t('settings.viewRoutes')}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={isDark ? '#666' : colors.textSecondary}
                />
              </TouchableOpacity>

              <View style={[styles.divider, isDark && styles.dividerDark]} />

              {isRouteProcessing && (
                <>
                  <TouchableOpacity
                    style={styles.actionRow}
                    onPress={cancelRouteProcessing}
                  >
                    <MaterialCommunityIcons
                      name="pause-circle-outline"
                      size={22}
                      color={colors.warning}
                    />
                    <Text style={[styles.actionText, isDark && styles.textLight]}>
                      {t('settings.pauseRouteProcessing')}
                    </Text>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={20}
                      color={isDark ? '#666' : colors.textSecondary}
                    />
                  </TouchableOpacity>
                  <View style={[styles.divider, isDark && styles.dividerDark]} />
                </>
              )}
            </>
          )}

          <TouchableOpacity style={styles.actionRow} onPress={handleClearCache}>
            <MaterialCommunityIcons name="delete-outline" size={22} color={colors.error} />
            <Text style={[styles.actionText, styles.actionTextDanger]}>{t('settings.clearAllReload')}</Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? '#666' : colors.textSecondary}
            />
          </TouchableOpacity>

          {routeSettings.enabled && (
            <>
              <View style={[styles.divider, isDark && styles.dividerDark]} />
              <TouchableOpacity style={styles.actionRow} onPress={handleClearRouteCache}>
                <MaterialCommunityIcons name="refresh" size={22} color={colors.warning} />
                <Text style={[styles.actionText, isDark && styles.textLight]}>{t('settings.reanalyseRoutes')}</Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={isDark ? '#666' : colors.textSecondary}
                />
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Cache Stats */}
        <View style={[styles.section, styles.sectionSpaced, isDark && styles.sectionDark]}>
          <View style={styles.statRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {cacheStats.totalActivities}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>{t('settings.activities')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {routeSettings.enabled ? routeGroups.length : '-'}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>{t('settings.routesCount')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {formatBytes(cacheSizes.bounds + cacheSizes.gps + cacheSizes.routes)}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>{t('settings.total')}</Text>
            </View>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>{t('settings.dateRange')}</Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {cacheStats.oldestDate && cacheStats.newestDate
                ? `${formatDate(cacheStats.oldestDate)} - ${formatDate(cacheStats.newestDate)}`
                : t('settings.noData')}
            </Text>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>{t('settings.lastSynced')}</Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {formatDate(cacheStats.lastSync)}
            </Text>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>{t('settings.bounds')}</Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {formatBytes(cacheSizes.bounds)}
            </Text>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>{t('settings.gpsTraces')}</Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {formatBytes(cacheSizes.gps)}
            </Text>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>{t('settings.routesCount')}</Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {formatBytes(cacheSizes.routes)}
            </Text>
          </View>
        </View>

        <Text style={[styles.infoText, isDark && styles.textMuted]}>
          {t('settings.cacheHint')}
        </Text>

        {/* Route Matching Toggle */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.routeMatching').toUpperCase()}</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={[styles.toggleLabel, isDark && styles.textLight]}>
                {t('settings.enableRouteMatching')}
              </Text>
              <Text style={[styles.toggleDescription, isDark && styles.textMuted]}>
                {t('settings.routeMatchingDescription')}
              </Text>
            </View>
            <Switch
              value={routeSettings.enabled}
              onValueChange={setRouteMatchingEnabled}
              color={colors.primary}
            />
          </View>
        </View>

        {/* Account Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.account').toUpperCase()}</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <TouchableOpacity style={styles.actionRow} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={22} color={colors.error} />
            <Text style={[styles.actionText, styles.actionTextDanger]}>{t('settings.disconnectAccount')}</Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? '#666' : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Data Sources Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.dataSources').toUpperCase()}</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.dataSourcesContent}>
            <Text style={[styles.dataSourcesText, isDark && styles.textMuted]}>
              {t('settings.dataSourcesDescription')}
            </Text>
            <View style={styles.dataSourcesLogos}>
              <View style={styles.dataSourceItem}>
                <MaterialCommunityIcons name="watch" size={20} color={isDark ? '#888' : colors.textSecondary} />
                <Text style={[styles.dataSourceName, isDark && styles.textLight]}>Garmin</Text>
              </View>
              <View style={styles.dataSourceItem}>
                <MaterialCommunityIcons name="run" size={20} color={isDark ? '#888' : colors.textSecondary} />
                <Text style={[styles.dataSourceName, isDark && styles.textLight]}>Strava</Text>
              </View>
              <View style={styles.dataSourceItem}>
                <MaterialCommunityIcons name="watch" size={20} color={isDark ? '#888' : colors.textSecondary} />
                <Text style={[styles.dataSourceName, isDark && styles.textLight]}>Polar</Text>
              </View>
              <View style={styles.dataSourceItem}>
                <MaterialCommunityIcons name="watch" size={20} color={isDark ? '#888' : colors.textSecondary} />
                <Text style={[styles.dataSourceName, isDark && styles.textLight]}>Wahoo</Text>
              </View>
            </View>
            <Text style={[styles.trademarkText, isDark && styles.textMuted]}>
              {t('attribution.garminTrademark')}
            </Text>
          </View>
        </View>

        {/* Support Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>{t('settings.support').toUpperCase()}</Text>
        <View style={styles.supportRow}>
          <TouchableOpacity
            style={[styles.supportCard, isDark && styles.supportCardDark]}
            onPress={() => WebBrowser.openBrowserAsync('https://intervals.icu/settings/subscription')}
            activeOpacity={0.7}
          >
            <View style={[styles.supportIconBg, { backgroundColor: 'rgba(233, 30, 99, 0.12)' }]}>
              <MaterialCommunityIcons name="heart" size={24} color="#E91E63" />
            </View>
            <Text style={[styles.supportTitle, isDark && styles.textLight]}>intervals.icu</Text>
            <Text style={[styles.supportSubtitle, isDark && styles.textMuted]}>{t('settings.subscribe')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.supportCard, isDark && styles.supportCardDark]}
            onPress={() => WebBrowser.openBrowserAsync('https://github.com/sponsors/evanjt')}
            activeOpacity={0.7}
          >
            <View style={[styles.supportIconBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]}>
              <MaterialCommunityIcons name="github" size={24} color={isDark ? '#FFF' : '#333'} />
            </View>
            <Text style={[styles.supportTitle, isDark && styles.textLight]}>@evanjt</Text>
            <Text style={[styles.supportSubtitle, isDark && styles.textMuted]}>{t('settings.sponsorDev')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: '#121212',
  },
  content: {
    paddingBottom: spacing.xl,
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
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionSpaced: {
    marginTop: spacing.md,
  },
  sectionDark: {
    backgroundColor: '#1E1E1E',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  profilePhoto: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E8E8E8',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  profilePhotoDark: {
    backgroundColor: '#333',
  },
  profileInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  profileEmail: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  syncBannerText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
  },
  statRow: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoRowDark: {
    borderTopColor: '#333',
  },
  infoLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  actionTextDisabled: {
    color: colors.textSecondary,
  },
  actionTextDanger: {
    color: colors.error,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 22 + spacing.sm, // icon + gap
  },
  dividerDark: {
    backgroundColor: '#333',
  },
  infoText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginHorizontal: layout.screenPadding,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  supportRow: {
    flexDirection: 'row',
    marginHorizontal: layout.screenPadding,
    gap: spacing.sm,
  },
  supportCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  supportCardDark: {
    backgroundColor: '#1E1E1E',
    shadowOpacity: 0,
  },
  supportIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  supportTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  supportSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  toggleInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  toggleDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textLight: {
    color: '#FFF',
  },
  textMuted: {
    color: '#888',
  },
  themePickerContainer: {
    padding: spacing.md,
  },
  themePicker: {
    // React Native Paper SegmentedButtons handles styling
  },
  mapStyleRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  mapStyleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  actionRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  activityStylesContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  activityStyleRow: {
    marginTop: spacing.md,
  },
  activityStyleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  activityStylePicker: {
    // Handled by React Native Paper
  },
  activityStyleHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.md,
    fontStyle: 'italic',
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
    borderTopColor: '#333',
  },
  languageLabel: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  dataSourcesContent: {
    padding: spacing.md,
  },
  dataSourcesText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  dataSourcesLogos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  dataSourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dataSourceName: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  trademarkText: {
    fontSize: 10,
    color: colors.textSecondary,
    opacity: 0.7,
    lineHeight: 14,
  },
});
