/**
 * Slide-to-unlock track shown in place of the ControlBar while the
 * recording screen is locked. The rest of the screen stays exactly as it
 * is; this is the only interactive element in the locked state.
 *
 * A screen reader, a switch or a keyboard produces no drag, so the track is
 * also one accessible button whose activate action unlocks. An assistive
 * activation is deliberate, which a stray touch is not, so pocket and rain
 * touches are still filtered by the slide.
 */

import React, { useRef, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  PanResponder,
  type AccessibilityActionEvent,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as haptics from '@/shared/ui/haptics';

import { useTheme } from '@/shared/app';
import {
  colors,
  colorWithOpacity,
  darkColors,
  duration,
  iconSize,
  opacity,
  spacing,
  typography,
  themePalette,
} from '@/theme';
import { motionSpring, motionTiming } from '@/shared/ui/reduceMotion';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';

const HANDLE_SIZE = 48;
const TRACK_HEIGHT = 56;
const ACCESSIBILITY_ACTIONS = [{ name: 'activate' }];
// How far the handle starts along the track when a back press meets the lock.
const HINT_TRAVEL = HANDLE_SIZE / 2;

/**
 * `hint` counts the inputs the lock has refused, such as a system back. Each new
 * value starts the handle along the track and lets it settle, which shows where
 * the screen unlocks.
 */
export function UnlockTrack({ onUnlock, hint = 0 }: { onUnlock: () => void; hint?: number }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const translateX = useRef(new Animated.Value(0)).current;
  const trackWidthRef = useRef(0);
  const hasTriggeredRef = useRef(false);

  const handleUnlock = useCallback(() => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;
    haptics.selection();
    onUnlock();
    setTimeout(() => {
      translateX.setValue(0);
      hasTriggeredRef.current = false;
    }, 300);
  }, [onUnlock, translateX]);

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'activate') handleUnlock();
    },
    [handleUnlock]
  );

  useEffect(() => {
    if (hint === 0) return;
    haptics.light();
    Animated.sequence([
      motionTiming(translateX, {
        toValue: HINT_TRAVEL,
        duration: duration.quick,
        useNativeDriver: true,
      }),
      motionSpring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 6,
      }),
    ]).start();
  }, [hint, translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        haptics.light();
      },
      onPanResponderMove: (_, gesture) => {
        const threshold = trackWidthRef.current - HANDLE_SIZE - spacing.xs * 2;
        translateX.setValue(Math.max(0, Math.min(gesture.dx, threshold)));
      },
      onPanResponderRelease: (_, gesture) => {
        // Unlock at 80% of the travel rather than the absolute end. Requiring
        // the final pixels makes the gesture feel unresponsive, and a swipe
        // that lands just short reads as the control being broken.
        const travel = trackWidthRef.current - HANDLE_SIZE - spacing.xs * 2;
        const threshold = travel * 0.8;
        if (threshold > 0 && gesture.dx >= threshold) {
          handleUnlock();
        } else {
          motionSpring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 80,
            friction: 10,
          }).start();
        }
      },
    })
  ).current;

  return (
    <View
      testID="unlock-track"
      accessible
      focusable
      accessibilityRole="button"
      accessibilityLabel={t('recording.unlockControls')}
      accessibilityHint={t('recording.slideToUnlock')}
      accessibilityActions={ACCESSIBILITY_ACTIONS}
      onAccessibilityAction={onAccessibilityAction}
      style={[styles.track, isDark && styles.trackDark]}
      onLayout={(e) => {
        trackWidthRef.current = e.nativeEvent.layout.width;
      }}
    >
      <Animated.Text
        testID="unlock-track-label"
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        numberOfLines={1}
        style={[
          styles.label,
          { color: isDark ? darkColors.textSecondary : colors.textSecondary },
          {
            opacity: translateX.interpolate({
              inputRange: [0, 80],
              outputRange: [1, 0],
              extrapolate: 'clamp',
            }),
          },
        ]}
      >
        {t('recording.slideToUnlock', 'Slide to unlock')}
      </Animated.Text>
      <Animated.View
        testID="unlock-track-handle"
        style={[styles.handle, { backgroundColor: palette.primary, transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <MaterialCommunityIcons
          name="lock-open-outline"
          size={iconSize.lg}
          color={colors.textOnPrimary}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    marginHorizontal: spacing.lg,
    backgroundColor: colorWithOpacity(colors.shadowBlack, 0.08),
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    overflow: 'hidden',
  },
  trackDark: {
    backgroundColor: colorWithOpacity(colors.textOnDark, opacity.tint2),
  },
  // Inset past the handle at rest, so a long translation or a large text size
  // never runs under it.
  label: {
    ...typography.bodyMedium,
    position: 'absolute',
    left: spacing.xs + HANDLE_SIZE + spacing.xs,
    right: spacing.md,
    textAlign: 'center',
    letterSpacing: 1,
  },
  handle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
