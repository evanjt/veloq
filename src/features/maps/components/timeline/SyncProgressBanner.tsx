/**
 * Sync progress banner for the map timeline.
 * Shows GPS download, route analysis, and bounds sync progress.
 */

import React, { useMemo, useEffect, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  withTiming,
  withRepeat,
  useSharedValue,
  cancelAnimation,
} from 'react-native-reanimated';
import { useTheme } from '@/shared/app';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { isExtendedFetchRunning } from '@/shared/app/extendedFetch';
import { formatTrackStage } from '../../lib/syncProgressFormat';
import { formatLibraryCoverage } from '@/shared/format/libraryCoverage';
import { useLibraryCoverage } from '@/shared/native/useLibraryCoverage';
import { useTrackStage } from '@/shared/native/useSyncStatus';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import {
  colors,
  colorWithOpacity,
  duration,
  easing,
  iconSize,
  ink,
  motionPairs,
  spacing,
  typography,
  themePalette,
  opacity,
} from '@/theme';
import { Icon } from '@/shared/ui/Icon';

interface SyncProgressBannerProps {
  /** Whether the banner is visible */
  visible?: boolean;
}

export function SyncProgressBanner({ visible = true }: SyncProgressBannerProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  // The track work as the engine reports it, whoever started it.
  const trackStage = useTrackStage();
  const isFetchingExtended = useSyncDateRange((s) => isExtendedFetchRunning(s.extendedFetch));

  // The queue figure above is the running pass's own, so it reaches "12/12"
  // with a thousand rides still upstream. These lines are the library.
  const coverage = useLibraryCoverage();
  const libraryLines = useMemo(() => formatLibraryCoverage(coverage, t), [coverage, t]);

  // The track work first, then the window download that comes before it.
  const displayInfo = useMemo(() => {
    if (trackStage) {
      return formatTrackStage(trackStage, t);
    }
    if (isFetchingExtended) {
      return {
        icon: 'cloud-download-outline',
        text: t('mapScreen.loadingOlderActivities') as string,
        percent: 0,
        countText: null,
        indeterminate: true,
      };
    }
    return null;
  }, [trackStage, isFetchingExtended, t]);

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
    heightFraction.value = withTiming(shouldShow ? 1 : 0, {
      duration: shouldShow ? motionPairs.banner.enter : motionPairs.banner.exit,
    });
  }, [shouldShow, heightFraction]);

  useEffect(() => {
    if (percent === null) return;
    // A longer duration for the progress bar so it interpolates between
    // reported values instead of jumping (600ms is about four poll cycles).
    progressValue.value = withTiming(percent / 100, {
      duration: duration.message,
      easing: easing.linear,
    });
  }, [percent, progressValue]);

  // Indeterminate animation
  const isIndeterminate = displayInfo?.indeterminate ?? false;
  useEffect(() => {
    if (isIndeterminate) {
      indeterminateOffset.value = 0;
      indeterminateOffset.value = withRepeat(
        withTiming(1, { duration: duration.loop, easing: easing.linear }),
        -1,
        false
      );
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
      style={[styles.container, { backgroundColor: palette.actionPrimary }, containerStyle]}
      accessibilityLiveRegion="polite"
      testID="sync-progress-banner"
    >
      <View onLayout={onContentLayout} testID="sync-progress-banner-content">
        <View style={styles.content}>
          <Icon
            name={displayInfo.icon as keyof typeof MaterialCommunityIcons.glyphMap}
            size={iconSize.sm}
            color={colors.textOnFill}
          />
          <Text style={styles.text} testID="sync-progress-message">
            {displayInfo.text}
          </Text>
          {displayInfo.countText ? (
            <Text style={styles.countText}>{displayInfo.countText}</Text>
          ) : null}
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
    ...typography.bodyCompactBold,
    color: colors.textOnFill,
  },
  countText: {
    ...typography.caption,
    color: colors.textOnFill,
  },
  libraryLines: {
    alignItems: 'center',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colorWithOpacity(ink.black, opacity.tint3),
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.textOnFill,
  },
  indeterminateFill: {
    width: '30%',
    position: 'absolute',
  },
});
