/**
 * Global GPS data sync component.
 * Runs in the background to automatically sync activity GPS data to the Rust engine.
 * This ensures GPS data is downloaded regardless of which screen the user is on.
 * Shows a banner at the top of the screen when syncing is in progress.
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSegments } from 'expo-router';
import { useActivities, useRouteDataSync } from '@/hooks';
import { useAuthStore, useRouteSettings, useSyncDateRange } from '@/providers';
import { colors, opacity } from '@/theme';

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
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);
  const delayedUnlockExpansion = useSyncDateRange((s) => s.delayedUnlockExpansion);

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

  // Unlock expansion after sync completes (with delay to let UI stabilize)
  useEffect(() => {
    if (progress.status === 'complete' && isExpansionLocked) {
      delayedUnlockExpansion();
    }
  }, [progress.status, isExpansionLocked, delayedUnlockExpansion]);

  // Don't show banner on screens that have their own sync indicator
  const isOnMapScreen = routeParts.includes('map' as never);
  const isOnRoutesScreen = routeParts.includes('routes' as never);
  // Show banner when fetching activities OR syncing GPS data
  const shouldShowBanner = (isFetching || isSyncing) && !isOnMapScreen && !isOnRoutesScreen;

  // Animated value for indeterminate progress bar
  const indeterminateAnim = useRef(new Animated.Value(0)).current;

  // Run indeterminate animation when in fetching phase (no real-time progress available)
  useEffect(() => {
    if (shouldShowBanner && (progress.status === 'fetching' || (isFetching && !isSyncing))) {
      // Loop animation for indeterminate state
      const animation = Animated.loop(
        Animated.timing(indeterminateAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: false,
        })
      );
      animation.start();
      return () => animation.stop();
    } else {
      indeterminateAnim.setValue(0);
    }
  }, [shouldShowBanner, progress.status, isFetching, isSyncing, indeterminateAnim]);

  if (!shouldShowBanner) {
    return null;
  }

  // Calculate banner height for notch/Dynamic Island
  const topPadding =
    Platform.OS === 'android' ? Math.max(insets.top, 24) : Math.max(insets.top, 20);

  const progressPercent =
    progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  // Determine status text based on current operation
  const statusText = (() => {
    // Activity list fetching (before GPS sync starts)
    if (isFetching && !isSyncing) {
      return 'Fetching activities...';
    }
    // GPS sync in progress - show real-time progress from Rust callbacks
    if (progress.status === 'fetching') {
      // Show real progress when available (callback updates completed count)
      if (progress.total > 0 && progress.completed > 0) {
        return `Downloading GPS data... ${progressPercent}%`;
      }
      return progress.total > 0
        ? `Downloading GPS data for ${progress.total} activities...`
        : progress.message || 'Downloading GPS data...';
    }
    if (progress.status === 'processing') {
      return progress.total > 0
        ? `Processing ${progress.total} routes...`
        : progress.message || 'Processing routes...';
    }
    if (progress.status === 'computing') {
      return progress.message || 'Detecting route sections...';
    }
    // Fallback for any other syncing state
    if (isSyncing) {
      return progress.message || `Syncing... ${progressPercent}%`;
    }
    return 'Syncing...';
  })();

  // Determine icon based on current operation
  const iconName = (() => {
    // Activity list fetching
    if (isFetching && !isSyncing) {
      return 'cloud-download-outline' as const;
    }
    // GPS data fetching from API
    if (progress.status === 'fetching') {
      return 'cloud-sync-outline' as const;
    }
    // Processing routes or computing sections
    if (progress.status === 'processing' || progress.status === 'computing') {
      return 'map-marker-path' as const;
    }
    return 'cloud-sync-outline' as const;
  })();

  // Determine if we should show indeterminate progress
  // (when fetching activities list OR GPS data with no completed count yet)
  const showIndeterminate =
    (isFetching && !isSyncing) || (progress.status === 'fetching' && progress.completed === 0);

  // Animated width for indeterminate progress bar (slides across)
  const indeterminateLeft = indeterminateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['-30%', '100%'],
  });

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={styles.content}>
        <MaterialCommunityIcons name={iconName} size={16} color={colors.textOnDark} />
        <Text style={styles.text}>{statusText}</Text>
        {progress.total > 0 && progress.completed > 0 && (
          <Text style={styles.countText}>
            {progress.completed}/{progress.total}
          </Text>
        )}
      </View>
      <View style={styles.progressTrack}>
        {showIndeterminate ? (
          // Indeterminate sliding animation when no real progress available
          <Animated.View
            style={[styles.progressFill, styles.indeterminateFill, { left: indeterminateLeft }]}
          />
        ) : (
          // Determinate progress bar when we have real progress
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        )}
      </View>
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
    color: colors.textOnDark,
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
    backgroundColor: colors.textOnDark,
  },
  indeterminateFill: {
    width: '30%',
    position: 'absolute',
  },
});
