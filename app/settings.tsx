import React, { useState, useEffect } from 'react';
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
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SegmentedButtons } from 'react-native-paper';
import { useAthlete, useActivityBoundsCache } from '@/hooks';
import { getAthleteId } from '@/api';
import {
  getThemePreference,
  setThemePreference,
  useMapPreferences,
  type ThemePreference,
} from '@/providers';
import { type MapStyleType } from '@/components/maps';
import { colors, darkColors, spacing, layout } from '@/theme';
import type { ActivityType } from '@/types';

// Activity type groups for map settings
// Each group applies the same map style to all its activity types
// Covers ALL ActivityType values from types/activity.ts
const MAP_ACTIVITY_GROUPS: { key: string; label: string; types: ActivityType[] }[] = [
  { key: 'cycling', label: 'Cycling', types: ['Ride', 'VirtualRide'] },
  { key: 'running', label: 'Running', types: ['Run', 'TrailRun', 'VirtualRun'] },
  { key: 'hiking', label: 'Hiking', types: ['Hike', 'Snowshoe'] },
  { key: 'walking', label: 'Walking', types: ['Walk'] },
  { key: 'swimming', label: 'Swimming', types: ['Swim', 'OpenWaterSwim'] },
  { key: 'snow', label: 'Snow Sports', types: ['AlpineSki', 'NordicSki', 'BackcountrySki', 'Snowboard'] },
  { key: 'water', label: 'Water Sports', types: ['Rowing', 'Kayaking', 'Canoeing'] },
  { key: 'climbing', label: 'Climbing', types: ['RockClimbing'] },
  { key: 'racket', label: 'Racket Sports', types: ['Tennis'] },
  { key: 'other', label: 'Other', types: ['Workout', 'WeightTraining', 'Yoga', 'Other'] },
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
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [profileImageError, setProfileImageError] = useState(false);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [showActivityStyles, setShowActivityStyles] = useState(false);

  const { data: athlete } = useAthlete();
  const { preferences: mapPreferences, setDefaultStyle, setActivityGroupStyle } = useMapPreferences();

  // Load saved theme preference on mount
  useEffect(() => {
    getThemePreference().then(setThemePreferenceState);
  }, []);

  const handleThemeChange = async (value: string) => {
    const preference = value as ThemePreference;
    setThemePreferenceState(preference);
    await setThemePreference(preference);
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

  const {
    activities,
    progress,
    cacheStats,
    clearCache,
    syncAllHistory,
  } = useActivityBoundsCache();

  const profileUrl = athlete?.profile_medium || athlete?.profile;
  const hasValidProfileUrl = profileUrl && typeof profileUrl === 'string' && profileUrl.startsWith('http');

  // Estimate cache size (rough approximation)
  const estimatedCacheBytes = activities.length * 200; // ~200 bytes per activity entry

  const handleClearCache = () => {
    Alert.alert(
      'Clear Cache',
      'This will remove all cached activity bounds. They will be re-synced when you open the map.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearCache();
            Alert.alert('Cache Cleared', 'Activity bounds cache has been cleared.');
          },
        },
      ]
    );
  };

  const handleSyncAll = () => {
    if (progress.status === 'syncing') {
      Alert.alert('Sync in Progress', 'Please wait for the current sync to complete.');
      return;
    }

    Alert.alert(
      'Sync All History',
      'This will sync up to 10 years of activity bounds in the background. This may take a while.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sync',
          onPress: syncAllHistory,
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header with back button */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={isDark ? '#FFF' : colors.textPrimary}
            />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>Settings</Text>
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
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>APPEARANCE</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.themePickerContainer}>
            <SegmentedButtons
              value={themePreference}
              onValueChange={handleThemeChange}
              buttons={[
                {
                  value: 'system',
                  label: 'System',
                  icon: 'cellphone',
                },
                {
                  value: 'light',
                  label: 'Light',
                  icon: 'white-balance-sunny',
                },
                {
                  value: 'dark',
                  label: 'Dark',
                  icon: 'moon-waning-crescent',
                },
              ]}
              style={styles.themePicker}
            />
          </View>
        </View>

        {/* Maps Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>MAPS</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.mapStyleRow}>
            <Text style={[styles.mapStyleLabel, isDark && styles.textLight]}>Default Style</Text>
          </View>
          <View style={styles.themePickerContainer}>
            <SegmentedButtons
              value={mapPreferences.defaultStyle}
              onValueChange={handleDefaultMapStyleChange}
              buttons={[
                {
                  value: 'light',
                  label: 'Light',
                  icon: 'map',
                },
                {
                  value: 'dark',
                  label: 'Dark',
                  icon: 'map',
                },
                {
                  value: 'satellite',
                  label: 'Satellite',
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
              Customize by Activity Type
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
              {MAP_ACTIVITY_GROUPS.map(({ key, label, types }) => {
                // Use the first type in the group to determine current style
                const currentStyle = mapPreferences.activityTypeStyles[types[0]] ?? 'default';
                return (
                  <View key={key} style={styles.activityStyleRow}>
                    <Text style={[styles.activityStyleLabel, isDark && styles.textLight]}>
                      {label}
                    </Text>
                    <SegmentedButtons
                      value={currentStyle}
                      onValueChange={(value) => handleActivityGroupMapStyleChange(key, value)}
                      buttons={[
                        { value: 'default', label: 'Default' },
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' },
                        { value: 'satellite', label: 'Satellite' },
                      ]}
                      density="small"
                      style={styles.activityStylePicker}
                    />
                  </View>
                );
              })}
              <Text style={[styles.activityStyleHint, isDark && styles.textMuted]}>
                'Default' uses the map style set above
              </Text>
            </View>
          )}
        </View>

        {/* Cache Status Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>MAP CACHE</Text>
        <View style={[styles.section, isDark && styles.sectionDark]}>
          {/* Sync Status */}
          {progress.status === 'syncing' && (
            <View style={styles.syncBanner}>
              <MaterialCommunityIcons name="sync" size={18} color="#FFF" />
              <Text style={styles.syncBannerText}>
                {progress.message || `Syncing ${progress.completed}/${progress.total}`}
              </Text>
            </View>
          )}

          <View style={styles.statRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {cacheStats.totalActivities}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>Activities</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {formatBytes(estimatedCacheBytes)}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>Cache Size</Text>
            </View>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>Date Range</Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {cacheStats.oldestDate && cacheStats.newestDate
                ? `${formatDate(cacheStats.oldestDate)} - ${formatDate(cacheStats.newestDate)}`
                : 'No data'}
            </Text>
          </View>

          <View style={[styles.infoRow, isDark && styles.infoRowDark]}>
            <Text style={[styles.infoLabel, isDark && styles.textMuted]}>Last Synced</Text>
            <Text style={[styles.infoValue, isDark && styles.textLight]}>
              {formatDate(cacheStats.lastSync)}
            </Text>
          </View>
        </View>

        {/* Cache Actions */}
        <View style={[styles.section, styles.sectionSpaced, isDark && styles.sectionDark]}>
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
              Sync All History
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? '#666' : colors.textSecondary}
            />
          </TouchableOpacity>

          <View style={[styles.divider, isDark && styles.dividerDark]} />

          <TouchableOpacity style={styles.actionRow} onPress={handleClearCache}>
            <MaterialCommunityIcons name="delete-outline" size={22} color={colors.error} />
            <Text style={[styles.actionText, styles.actionTextDanger]}>Clear Cache</Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? '#666' : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Cache info text */}
        <Text style={[styles.infoText, isDark && styles.textMuted]}>
          The map cache stores activity bounds for quick access when viewing the regional map.
          Syncing all history will fetch bounds for activities up to 10 years in the background.
        </Text>

        {/* Support Section */}
        <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>SUPPORT</Text>
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
            <Text style={[styles.supportSubtitle, isDark && styles.textMuted]}>Subscribe</Text>
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
            <Text style={[styles.supportSubtitle, isDark && styles.textMuted]}>Sponsor dev</Text>
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
});
