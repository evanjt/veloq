/**
 * Sync progress banner for the map timeline.
 * Shows GPS download, route analysis, and bounds sync progress.
 */

import React, { useMemo, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  withTiming,
  withRepeat,
  useSharedValue,
  cancelAnimation,
} from 'react-native-reanimated';
import { useActivityBoundsCache } from '@/hooks';
import { useSyncDateRange } from '@/providers';
import { formatGpsSyncProgress, formatBoundsSyncProgress } from '@/lib/utils/syncProgressFormat';
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

  // Use shared formatter — bounds syncing takes priority
  const displayInfo = useMemo(() => {
    if (isSyncingBounds) {
      return formatBoundsSyncProgress(boundsProgress, t);
    }
    if (isProcessingRoutes) {
      return formatGpsSyncProgress(gpsSyncProgress, false, t);
    }
    return null;
  }, [isSyncingBounds, isProcessingRoutes, boundsProgress, gpsSyncProgress, t]);

  // Should show when visible AND there's something to display
  const shouldShow = visible && displayInfo !== null;

  // Shared values for native-thread animations
  const progressValue = useSharedValue(0);
  const heightFraction = useSharedValue(0);
  const indeterminateOffset = useSharedValue(0);

  // Update shared values reactively
  heightFraction.value = withTiming(shouldShow ? 1 : 0, { duration: 200 });
  if (displayInfo) {
    progressValue.value = withTiming(displayInfo.percent / 100, { duration: 150 });
  }

  // Indeterminate animation
  const isIndeterminate = displayInfo?.indeterminate ?? false;
  useEffect(() => {
    if (isIndeterminate) {
      indeterminateOffset.value = 0;
      indeterminateOffset.value = withRepeat(withTiming(1, { duration: 1500 }), -1, false);
    } else {
      cancelAnimation(indeterminateOffset);
      indeterminateOffset.value = 0;
    }
  }, [isIndeterminate, indeterminateOffset]);

  const containerStyle = useAnimatedStyle(() => ({
    height: heightFraction.value * 42,
    opacity: heightFraction.value,
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressValue.value * 100}%` as `${number}%`,
  }));

  const indeterminateStyle = useAnimatedStyle(() => ({
    left: `${indeterminateOffset.value * 130 - 30}%` as `${number}%`,
  }));

  // Don't render at all if not showing
  if (!shouldShow || !displayInfo) {
    return null;
  }

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <View style={styles.content}>
        <MaterialCommunityIcons
          name={displayInfo.icon as keyof typeof MaterialCommunityIcons.glyphMap}
          size={16}
          color="#FFFFFF"
        />
        <Text style={styles.text}>
          {displayInfo.text}
          {displayInfo.percent > 0 ? `... ${displayInfo.percent}%` : '...'}
        </Text>
        {displayInfo.countText && <Text style={styles.countText}>{displayInfo.countText}</Text>}
      </View>
      <View style={styles.progressTrack}>
        {displayInfo.indeterminate ? (
          <Animated.View
            style={[styles.progressFill, styles.indeterminateFill, indeterminateStyle]}
          />
        ) : (
          <Animated.View style={[styles.progressFill, progressStyle]} />
        )}
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
  indeterminateFill: {
    width: '30%',
    position: 'absolute',
  },
});
