import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, UIManager, LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface SyncProgressBannerProps {
  completed: number;
  total: number;
  message?: string;
  /** Whether the banner is visible */
  visible?: boolean;
}

// Timing config for smooth progress bar - easeOut for natural deceleration
const PROGRESS_TIMING_CONFIG = {
  duration: 300,
  easing: Easing.out(Easing.quad),
};

const VISIBILITY_TIMING_CONFIG = {
  duration: 250,
  easing: Easing.inOut(Easing.ease),
};

/**
 * Delay before resetting progress to 0 after sync completes.
 * This prevents flickering when a new sync starts immediately after completion.
 */
const PROGRESS_RESET_DELAY = 500;

export function SyncProgressBanner({
  completed,
  total,
  message,
  visible = true,
}: SyncProgressBannerProps) {
  const { t } = useTranslation();

  // Track width for pixel-based progress animation
  const [trackWidth, setTrackWidth] = useState(0);

  // Shared values for smooth animations (runs on UI thread)
  const progressWidth = useSharedValue(0);
  const visibility = useSharedValue(visible ? 1 : 0);
  const textOpacity = useSharedValue(1);

  const [displayedMessage, setDisplayedMessage] = useState(message);
  const [isHidden, setIsHidden] = useState(!visible);

  // Track the highest progress value to prevent backwards jumps (monotonic progress)
  // This prevents flickering when progress updates arrive out of order
  const maxProgressRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTotalRef = useRef(0);

  // Measure track width
  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    setTrackWidth(width);
  }, []);

  // Animate visibility changes
  useEffect(() => {
    if (visible) {
      setIsHidden(false);
      visibility.value = withTiming(1, VISIBILITY_TIMING_CONFIG);
    } else {
      visibility.value = withTiming(0, VISIBILITY_TIMING_CONFIG, (finished) => {
        if (finished) {
          runOnJS(setIsHidden)(true);
        }
      });
    }
  }, [visible, visibility]);

  // Animate progress with timing - pixel-based for smooth animation
  // Uses monotonic progress to prevent backwards jumps
  useEffect(() => {
    // Clear any pending reset timer when new progress arrives
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    if (total > 0 && trackWidth > 0) {
      const targetProgress = completed / total;

      // Detect if this is a new sync cycle (total changed significantly or progress dropped to near 0)
      const isNewSyncCycle =
        (lastTotalRef.current > 0 && total !== lastTotalRef.current && completed < total * 0.1) ||
        (completed === 0 && lastTotalRef.current === 0);

      // If new sync cycle, reset the max progress tracker
      if (isNewSyncCycle) {
        maxProgressRef.current = 0;
      }

      // Only update if progress increased (monotonic) or this is a new sync cycle
      if (targetProgress >= maxProgressRef.current || isNewSyncCycle) {
        maxProgressRef.current = targetProgress;
        const targetWidth = targetProgress * trackWidth;
        progressWidth.value = withTiming(targetWidth, PROGRESS_TIMING_CONFIG);
      }

      lastTotalRef.current = total;
    } else if (trackWidth > 0 && total === 0 && lastTotalRef.current > 0) {
      // Sync completed (total went to 0) - delay the reset to prevent flickering
      // if a new sync starts immediately
      resetTimerRef.current = setTimeout(() => {
        maxProgressRef.current = 0;
        progressWidth.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) });
        lastTotalRef.current = 0;
      }, PROGRESS_RESET_DELAY);
    }

    // Cleanup timer on unmount
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, [completed, total, trackWidth, progressWidth]);

  // Smooth text transition when message changes
  useEffect(() => {
    if (message !== displayedMessage && message) {
      // Subtle fade for text changes
      textOpacity.value = withTiming(0.7, { duration: 60 }, () => {
        runOnJS(setDisplayedMessage)(message);
        textOpacity.value = withTiming(1, { duration: 100 });
      });
    } else if (message && !displayedMessage) {
      setDisplayedMessage(message);
    }
  }, [message, displayedMessage, textOpacity]);

  // Animated styles
  const bannerStyle = useAnimatedStyle(() => {
    const height = interpolate(visibility.value, [0, 1], [0, 42]);
    return {
      height,
      opacity: visibility.value,
    };
  });

  // Progress bar animated style - uses pixel width for smooth animation
  const progressStyle = useAnimatedStyle(() => {
    return {
      width: progressWidth.value,
    };
  });

  const textStyle = useAnimatedStyle(() => {
    return {
      opacity: textOpacity.value,
    };
  });

  // Don't render anything if fully hidden
  if (isHidden) {
    return null;
  }

  // Determine the display text
  const messageHasPercent = displayedMessage?.includes('%');
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const displayText =
    displayedMessage ||
    (total > 0 ? t('maps.syncingActivities', { completed, total }) : t('common.loading'));

  return (
    <Animated.View style={[styles.syncBanner, bannerStyle]}>
      <View style={styles.content}>
        <MaterialCommunityIcons name="cloud-sync-outline" size={16} color="#FFFFFF" />
        <Animated.Text style={[styles.syncText, textStyle]}>
          {displayText}
          {total > 0 && !messageHasPercent && ` ${progressPercent}%`}
        </Animated.Text>
        {total > 0 && !messageHasPercent && (
          <Animated.Text style={[styles.countText, textStyle]}>
            {completed}/{total}
          </Animated.Text>
        )}
      </View>
      <View style={styles.progressTrack} onLayout={onTrackLayout}>
        <Animated.View style={[styles.progressFill, progressStyle]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  syncBanner: {
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
  syncText: {
    color: colors.textOnDark,
    fontSize: typography.bodyCompact.fontSize,
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
