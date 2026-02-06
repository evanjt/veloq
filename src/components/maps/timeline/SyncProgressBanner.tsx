/**
 * Sync progress banner for the map timeline.
 * Uses the same data source as CacheLoadingBanner for consistent display.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, withTiming, useSharedValue } from 'react-native-reanimated';
import { useActivityBoundsCache } from '@/hooks';
import { useSyncDateRange } from '@/providers';
import { colors } from '@/theme';

interface SyncProgressBannerProps {
  /** Whether the banner is visible */
  visible?: boolean;
}

export function SyncProgressBanner({ visible = true }: SyncProgressBannerProps) {
  const { t } = useTranslation();
  const { progress: boundsProgress } = useActivityBoundsCache();

  // GPS sync progress from shared store
  const gpsSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);

  // Check if we're syncing bounds or processing routes
  const isSyncingBounds = boundsProgress.status === 'syncing';
  const isProcessingRoutes =
    isGpsSyncing &&
    (gpsSyncProgress.status === 'fetching' || gpsSyncProgress.status === 'computing');

  // Determine what to show - bounds syncing takes priority
  const displayInfo = useMemo(() => {
    if (isSyncingBounds) {
      return {
        icon: 'cloud-sync-outline' as const,
        text: t('cache.syncingActivities'),
        completed: boundsProgress.completed,
        total: boundsProgress.total,
      };
    }
    if (isProcessingRoutes) {
      if (gpsSyncProgress.status === 'fetching') {
        return {
          icon: 'download-outline' as const,
          text: t('routesScreen.downloadingGps', {
            completed: gpsSyncProgress.completed,
            total: gpsSyncProgress.total,
          }),
          completed: gpsSyncProgress.completed,
          total: gpsSyncProgress.total,
        };
      }
      if (gpsSyncProgress.status === 'computing') {
        return {
          icon: 'map-marker-path' as const,
          text: gpsSyncProgress.message || t('routesScreen.computingRoutes'),
          completed: gpsSyncProgress.completed,
          total: gpsSyncProgress.total,
        };
      }
    }
    return null;
  }, [isSyncingBounds, isProcessingRoutes, boundsProgress, gpsSyncProgress, t]);

  // Should show when visible AND there's something to display
  const shouldShow = visible && (isSyncingBounds || isProcessingRoutes) && displayInfo;

  // Shared values for native-thread animations
  const progress = useSharedValue(0);
  const heightFraction = useSharedValue(0);

  // Update shared values reactively
  heightFraction.value = withTiming(shouldShow ? 1 : 0, { duration: 200 });
  if (displayInfo && displayInfo.total > 0) {
    progress.value = withTiming(displayInfo.completed / displayInfo.total, { duration: 150 });
  }

  const containerStyle = useAnimatedStyle(() => ({
    height: heightFraction.value * 42,
    opacity: heightFraction.value,
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%` as `${number}%`,
  }));

  // Don't render at all if not showing
  if (!shouldShow || !displayInfo) {
    return null;
  }

  const progressPercent =
    displayInfo.total > 0 ? Math.round((displayInfo.completed / displayInfo.total) * 100) : 0;

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <View style={styles.content}>
        <MaterialCommunityIcons name={displayInfo.icon} size={16} color="#FFFFFF" />
        <Text style={styles.text}>
          {displayInfo.text}... {progressPercent}%
        </Text>
        <Text style={styles.countText}>
          {displayInfo.completed}/{displayInfo.total}
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, progressStyle]} />
      </View>
    </Animated.View>
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
    paddingVertical: 8,
    paddingHorizontal: 16,
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
});
