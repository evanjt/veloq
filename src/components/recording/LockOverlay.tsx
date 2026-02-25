import React, { useRef, useCallback } from 'react';
import { View, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { spacing } from '@/theme';

const HANDLE_SIZE = 56;
const TRACK_HEIGHT = 56;
const TRACK_HORIZONTAL_MARGIN = 40;
const SCREEN_WIDTH = Dimensions.get('window').width;
const TRACK_WIDTH = SCREEN_WIDTH - TRACK_HORIZONTAL_MARGIN * 2;
const UNLOCK_THRESHOLD = TRACK_WIDTH - HANDLE_SIZE;

interface LockOverlayProps {
  visible: boolean;
  elapsed: string;
  distance: string;
  onUnlock: () => void;
}

export function LockOverlay({ visible, elapsed, distance, onUnlock }: LockOverlayProps) {
  const { t } = useTranslation();
  const translateX = useRef(new Animated.Value(0)).current;
  const hasTriggeredRef = useRef(false);

  const handleUnlock = useCallback(() => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onUnlock();
    // Reset after unlock
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
        const clamped = Math.max(0, Math.min(gesture.dx, UNLOCK_THRESHOLD));
        translateX.setValue(clamped);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx >= UNLOCK_THRESHOLD) {
          handleUnlock();
        } else {
          // Spring back
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

  const labelOpacity = translateX.interpolate({
    inputRange: [0, UNLOCK_THRESHOLD * 0.5],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      {/* Block all touches except the slider */}
      <View style={styles.touchBlocker} pointerEvents="box-only" />

      {/* Live stats */}
      <Text style={styles.elapsed}>{elapsed}</Text>
      <Text style={styles.distance}>{distance}</Text>

      {/* Slide-to-unlock track */}
      <View style={styles.trackContainer}>
        <View style={styles.track}>
          {/* Label */}
          <Animated.Text style={[styles.trackLabel, { opacity: labelOpacity }]}>
            {t('recording.slideToUnlock', 'Slide to unlock')}
          </Animated.Text>

          {/* Handle */}
          <Animated.View
            style={[styles.handle, { transform: [{ translateX }] }]}
            {...panResponder.panHandlers}
          >
            <MaterialCommunityIcons
              name="lock-open-outline"
              size={24}
              color="rgba(255,255,255,0.9)"
            />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  touchBlocker: {
    ...StyleSheet.absoluteFillObject,
  },
  elapsed: {
    fontSize: 48,
    fontWeight: '200',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
    marginBottom: spacing.xs,
  },
  distance: {
    fontSize: 20,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.7)',
    marginBottom: spacing.xl * 3,
  },
  trackContainer: {
    position: 'absolute',
    bottom: 80,
    left: TRACK_HORIZONTAL_MARGIN,
    right: TRACK_HORIZONTAL_MARGIN,
  },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackLabel: {
    position: 'absolute',
    width: '100%',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.6)',
    letterSpacing: 1,
  },
  handle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
