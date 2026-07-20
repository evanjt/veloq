/**
 * Slide-to-unlock track shown in place of the ControlBar while the
 * recording screen is locked. The rest of the screen stays exactly as it
 * is; this is the only interactive element in the locked state.
 */

import React, { useRef, useCallback } from 'react';
import { View, StyleSheet, Animated, PanResponder } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/shared/app';
import { brand, colors, colorWithOpacity, darkColors, spacing } from '@/theme';

const HANDLE_SIZE = 48;
const TRACK_HEIGHT = 56;

export function UnlockTrack({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const trackWidthRef = useRef(0);
  const hasTriggeredRef = useRef(false);

  const handleUnlock = useCallback(() => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onUnlock();
    setTimeout(() => {
      translateX.setValue(0);
      hasTriggeredRef.current = false;
    }, 300);
  }, [onUnlock, translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      },
      onPanResponderMove: (_, gesture) => {
        const threshold = trackWidthRef.current - HANDLE_SIZE - spacing.xs * 2;
        translateX.setValue(Math.max(0, Math.min(gesture.dx, threshold)));
      },
      onPanResponderRelease: (_, gesture) => {
        const threshold = trackWidthRef.current - HANDLE_SIZE - spacing.xs * 2;
        if (threshold > 0 && gesture.dx >= threshold) {
          handleUnlock();
        } else {
          Animated.spring(translateX, {
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
      style={[styles.track, isDark && styles.trackDark]}
      onLayout={(e) => {
        trackWidthRef.current = e.nativeEvent.layout.width;
      }}
    >
      <Animated.Text
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
        style={[styles.handle, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <MaterialCommunityIcons name="lock-open-outline" size={22} color={colors.textOnDark} />
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
    backgroundColor: colorWithOpacity(colors.textOnDark, 0.12),
  },
  label: {
    position: 'absolute',
    width: '100%',
    textAlign: 'center',
    fontSize: 15,
    letterSpacing: 1,
  },
  handle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: brand.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
