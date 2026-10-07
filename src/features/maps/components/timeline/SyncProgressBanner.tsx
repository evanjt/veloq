/**
 * Sync progress banner for the map timeline.
 * Shows GPS download, route analysis, and bounds sync progress.
 */

import React, { useMemo, useEffect, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
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
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { isExtendedFetchRunning } from '@/shared/app/extendedFetch';
import { formatGpsSyncProgress } from '../../lib/syncProgressFormat';
import { formatLibraryCoverage } from '@/shared/format/libraryCoverage';
import { useLibraryCoverage } from '@/shared/native/useLibraryCoverage';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { colors, ink, typography, spacing, colorWithOpacity } from '@/theme';

interface SyncProgressBannerProps {
  /** Whether the banner is visible */
  visible?: boolean;
}

export function SyncProgressBanner({ visible = true }: SyncProgressBannerProps) {
  const { t } = useTranslation();
  // GPS sync progress from shared store
  const gpsSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);
  const isAnalysingInBackground = useSyncDateRange((s) => s.isAnalysingInBackground);
  const isFetchingExtended = useSyncDateRange((s) => isExtendedFetchRunning(s.extendedFetch));

  // The queue figure above is the running pass's own, so it reaches "12/12"
  // with a thousand rides still upstream. These lines are the library.
  const coverage = useLibraryCoverage();
  const libraryLines = useMemo(() => formatLibraryCoverage(coverage, t), [coverage, t]);

  const isProcessingRoutes =
    isAnalysingInBackground ||
    (isGpsSyncing &&
      (gpsSyncProgress.status === 'fetching' || gpsSyncProgress.status === 'computing'));

  // Show immediate feedback when fetching extended date range (before GPS sync starts)
  const isLoadingExtended = isFetchingExtended && !isProcessingRoutes;

  // Use shared formatter - GPS sync first, then extended fetch
  const displayInfo = useMemo(() => {
    if (isProcessingRoutes) {
      return formatGpsSyncProgress(gpsSyncProgress, false, t);
    }
    if (isLoadingExtended) {
      return {
        icon: 'cloud-download-outline',
        text: t('mapScreen.loadingOlderActivities') as string,
        percent: 0,
        countText: null,
        indeterminate: true,
      };
    }
    return null;
  }, [isProcessingRoutes, isLoadingExtended, gpsSyncProgress, t]);

  // Should show when visible AND there's something to display
  const shouldShow = visible && displayInfo !== null;

  // Shared values for native-thread animations
  const progressValue = useSharedValue(0);
  const heightFraction = useSharedValue(0);
  const indeterminateOffset = useSharedValue(0);

  // In an effect, not the render body. A write there restarts both animations
  // on every render the timeline causes, and on the renders React throws away,
  // so the ease starts again from wherever it had got to.
  const percent = displayInfo?.percent ?? null;
  useEffect(() => {
    heightFraction.value = withTiming(shouldShow ? 1 : 0, { duration: 200 });
  }, [shouldShow, heightFraction]);

  useEffect(() => {
    if (percent === null) return;
    // A longer duration for the progress bar so it interpolates between
    // reported values instead of jumping (600ms is about four poll cycles).
    progressValue.value = withTiming(percent / 100, { duration: 600 });
  }, [percent, progressValue]);

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

  // The content decides the height: the library lines come and go, and a fixed
  // figure clips them and the progress track beneath.
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const onContentLayout = (event: LayoutChangeEvent) => {
    setContentHeight(event.nativeEvent.layout.height);
  };

  const containerStyle = useAnimatedStyle(() => ({
    height: contentHeight === null ? undefined : heightFraction.value * contentHeight,
    opacity: heightFraction.value,
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressValue.value * 100}%` as `${number}%`,
  }));

  const indeterminateStyle = useAnimatedStyle(() => ({
    left: `${indeterminateOffset.value * 130 - 30}%` as `${number}%`,
  }));

  useAnnounceOnAppear(shouldShow ? displayInfo?.text : null);

  // Don't render at all if not showing
  if (!shouldShow || !displayInfo) {
    return null;
  }

  return (
    <Animated.View
      style={[styles.container, containerStyle]}
      accessibilityLiveRegion="polite"
      testID="sync-progress-banner"
    >
      <View onLayout={onContentLayout} testID="sync-progress-banner-content">
        <View style={styles.content}>
          <MaterialCommunityIcons
            name={displayInfo.icon as keyof typeof MaterialCommunityIcons.glyphMap}
            size={16}
            color={ink.white}
          />
          <Text style={styles.text} testID="sync-progress-message">
            {displayInfo.text}
            {displayInfo.percent > 0 ? `... ${displayInfo.percent}%` : '...'}
          </Text>
          {displayInfo.countText && <Text style={styles.countText}>{displayInfo.countText}</Text>}
        </View>
        {libraryLines.length > 0 && (
          <View style={styles.libraryLines} testID="sync-library-coverage">
            {libraryLines.map((line) => (
              <Text key={line} style={styles.countText}>
                {line}
              </Text>
            ))}
          </View>
        )}
        <View style={styles.progressTrack}>
          {displayInfo.indeterminate ? (
            <Animated.View
              style={[styles.progressFill, styles.indeterminateFill, indeterminateStyle]}
            />
          ) : (
            <Animated.View style={[styles.progressFill, progressStyle]} />
          )}
        </View>
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  text: {
    color: colors.textOnPrimary,
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
  },
  countText: {
    color: colorWithOpacity(ink.white, 0.7),
    fontSize: typography.caption.fontSize,
  },
  libraryLines: {
    alignItems: 'center',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colorWithOpacity(ink.black, 0.2),
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
