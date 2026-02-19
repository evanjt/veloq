/**
 * Global GPS data sync component.
 * Runs in the background to automatically sync activity GPS data to the Rust engine.
 * This ensures GPS data is downloaded regardless of which screen the user is on.
 * Shows a banner at the top of the screen when syncing is in progress.
 * Also shows bounds cache sync progress (absorbed from former CacheLoadingBanner).
 */

import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSegments, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, {
  useAnimatedStyle,
  withTiming,
  withRepeat,
  useSharedValue,
  cancelAnimation,
} from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { useActivities, useRouteDataSync, useActivityBoundsCache } from '@/hooks';
import { useAuthStore, useRouteSettings, useSyncDateRange } from '@/providers';
import { formatGpsSyncProgress, formatBoundsSyncProgress } from '@/lib/utils/syncProgressFormat';
import { colors } from '@/theme';

export function GlobalDataSync() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const routeParts = useSegments();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { settings: routeSettings } = useRouteSettings();

  // Get sync date range from global store (can be extended by timeline sliders)
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const setFetchingExtended = useSyncDateRange((s) => s.setFetchingExtended);
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);
  const delayedUnlockExpansion = useSyncDateRange((s) => s.delayedUnlockExpansion);

  // Startup alignment: invalidate activities on mount to force a fresh API fetch.
  // This catches any engine-API misalignment regardless of cause (stale cache,
  // new activities synced while app was closed, engine data loss, etc.).
  // Cost: one lightweight API call for the activity list metadata.
  useEffect(() => {
    if (isAuthenticated && routeSettings.enabled) {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch activities for GPS sync using dynamic date range
  const { data: activities, isFetching } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    includeStats: false,
    enabled: isAuthenticated && routeSettings.enabled,
  });

  // Prefetch 1 year of activities with stats for fitness tab cache warming
  useActivities({ days: 365, includeStats: true, enabled: isAuthenticated });

  // Update fetching state in store
  useEffect(() => {
    setFetchingExtended(isFetching);
  }, [isFetching, setFetchingExtended]);

  // Use the route data sync hook to automatically sync GPS data
  const { progress, isSyncing } = useRouteDataSync(activities, routeSettings.enabled);

  // Unlock expansion after sync completes (with delay to let UI stabilize)
  useEffect(() => {
    if (progress.status === 'complete' && isExpansionLocked) {
      delayedUnlockExpansion();
    }
  }, [progress.status, isExpansionLocked, delayedUnlockExpansion]);

  // Bounds sync progress (formerly CacheLoadingBanner)
  const { progress: boundsProgress } = useActivityBoundsCache();
  const isSyncingBounds = boundsProgress.status === 'syncing';

  // Don't show banner on screens that have their own sync indicator
  const isOnMapScreen = routeParts.includes('map' as never);
  const isOnRoutesScreen = routeParts.includes('routes' as never);

  // GPS sync display info
  const gpsDisplayInfo = useMemo(
    () => formatGpsSyncProgress(progress, isFetching && !isSyncing, t),
    [progress, isFetching, isSyncing, t]
  );

  // Bounds sync display info
  const boundsDisplayInfo = useMemo(
    () => formatBoundsSyncProgress(boundsProgress, t),
    [boundsProgress, t]
  );

  // Pick which info to show — GPS sync takes priority (it's more informative)
  const displayInfo = gpsDisplayInfo ?? boundsDisplayInfo;

  // Show banner when there's something to display and not on screens with own indicator
  const shouldShowBanner = displayInfo !== null && !isOnMapScreen && !isOnRoutesScreen;

  // Shared values for Reanimated animations
  const indeterminateOffset = useSharedValue(0);

  // Indeterminate animation
  const isIndeterminate = displayInfo?.indeterminate ?? false;
  useEffect(() => {
    if (shouldShowBanner && isIndeterminate) {
      indeterminateOffset.value = 0;
      indeterminateOffset.value = withRepeat(withTiming(1, { duration: 1500 }), -1, false);
    } else {
      cancelAnimation(indeterminateOffset);
      indeterminateOffset.value = 0;
    }
  }, [shouldShowBanner, isIndeterminate, indeterminateOffset]);

  const indeterminateStyle = useAnimatedStyle(() => ({
    left: `${indeterminateOffset.value * 130 - 30}%` as `${number}%`,
  }));

  if (!shouldShowBanner || !displayInfo) {
    return null;
  }

  // Calculate banner height for notch/Dynamic Island
  const topPadding =
    Platform.OS === 'android' ? Math.max(insets.top, 24) : Math.max(insets.top, 20);

  const handlePress = () => {
    router.push('/settings');
  };

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={handlePress}>
      <View style={[styles.container, { paddingTop: topPadding }]}>
        <View style={styles.content}>
          <MaterialCommunityIcons
            name={displayInfo.icon as keyof typeof MaterialCommunityIcons.glyphMap}
            size={16}
            color={colors.textOnDark}
          />
          <Text style={styles.text}>
            {displayInfo.text}
            {displayInfo.percent > 0 ? `... ${displayInfo.percent}%` : '...'}
          </Text>
          {displayInfo.countText && <Text style={styles.countText}>{displayInfo.countText}</Text>}
          <MaterialCommunityIcons name="chevron-right" size={16} color="rgba(255, 255, 255, 0.7)" />
        </View>
        <View style={styles.progressTrack}>
          {displayInfo.indeterminate ? (
            <Animated.View
              style={[styles.progressFill, styles.indeterminateFill, indeterminateStyle]}
            />
          ) : (
            <View style={[styles.progressFill, { width: `${displayInfo.percent}%` }]} />
          )}
        </View>
      </View>
    </TouchableOpacity>
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
