/**
 * Global GPS data sync component.
 * Runs in the background to automatically sync activity GPS data to the Rust engine.
 * This ensures GPS data is downloaded regardless of which screen the user is on.
 * Shows a banner at the top of the screen when syncing is in progress.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSegments } from 'expo-router';
import { useActivities, useRouteDataSync } from '@/hooks';
import { useAuthStore, useRouteSettings, useSyncDateRange } from '@/providers';
import { colors } from '@/theme';

export function GlobalDataSync() {
  const insets = useSafeAreaInsets();
  const routeParts = useSegments();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const { settings: routeSettings } = useRouteSettings();

  // Get sync date range from global store (can be extended by timeline sliders)
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const setFetchingExtended = useSyncDateRange((s) => s.setFetchingExtended);

  // Fetch activities for GPS sync using dynamic date range
  // When user extends timeline past 90 days, this will fetch older data
  const { data: activities, isFetching } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    includeStats: false,
    enabled: isAuthenticated && routeSettings.enabled,
  });

  // Update fetching state in store
  useEffect(() => {
    setFetchingExtended(isFetching);
  }, [isFetching, setFetchingExtended]);

  // Use the route data sync hook to automatically sync GPS data
  // This runs globally regardless of which screen the user is on
  const { progress, isSyncing } = useRouteDataSync(activities, routeSettings.enabled);

  // Don't show banner on screens that have their own sync indicator
  const isOnMapScreen = routeParts.includes('map' as never);
  const isOnRoutesScreen = routeParts.includes('routes' as never);
  const shouldShowBanner = isSyncing && !isOnMapScreen && !isOnRoutesScreen;

  if (!shouldShowBanner) {
    return null;
  }

  // Calculate banner height for notch/Dynamic Island
  const topPadding =
    Platform.OS === 'android' ? Math.max(insets.top, 24) : Math.max(insets.top, 20);

  const progressPercent =
    progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  const statusText =
    progress.status === 'computing' ? progress.message : `Syncing GPS data... ${progressPercent}%`;

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={styles.content}>
        <MaterialCommunityIcons
          name={progress.status === 'computing' ? 'map-marker-path' : 'cloud-sync-outline'}
          size={16}
          color="#FFFFFF"
        />
        <Text style={styles.text}>{statusText}</Text>
        {progress.total > 0 && (
          <Text style={styles.countText}>
            {progress.completed}/{progress.total}
          </Text>
        )}
      </View>
      {progress.total > 0 && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.primary,
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  countText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
  },
});
