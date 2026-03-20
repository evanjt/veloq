import React, { useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { spacing } from '@/theme';
import { RecordingMap } from '@/components/recording/RecordingMap';
import { GpsSignalIndicator } from '@/components/recording/GpsSignalIndicator';
import { getActivityIcon } from '@/lib/utils/activityUtils';
import type { RecordingMode, ActivityType } from '@/types';

const HANDLE_SIZE = 56;
const TRACK_HEIGHT = 56;
const TRACK_HORIZONTAL_MARGIN = 40;
const SCREEN_WIDTH = Dimensions.get('window').width;
const TRACK_WIDTH = SCREEN_WIDTH - TRACK_HORIZONTAL_MARGIN * 2;
const UNLOCK_THRESHOLD = TRACK_WIDTH - HANDLE_SIZE;
const FADE_DURATION = 200;

interface LockOverlayProps {
  visible: boolean;
  elapsed: string;
  distance: string;
  onUnlock: () => void;
  mode: RecordingMode;
  status: 'recording' | 'paused' | 'idle';
  accuracy: number | null;
  coordinates: [number, number][];
  currentLocation: { latitude: number; longitude: number } | null;
  activityType?: ActivityType;
  speed?: string;
  heartrate?: number;
}

export function LockOverlay({
  visible,
  elapsed,
  distance,
  onUnlock,
  mode,
  status,
  accuracy,
  coordinates,
  currentLocation,
  activityType,
  speed,
  heartrate,
}: LockOverlayProps) {
  const { t } = useTranslation();
  const translateX = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const hasTriggeredRef = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Smooth fade transition
  useEffect(() => {
    Animated.timing(overlayOpacity, {
      toValue: visible ? 1 : 0,
      duration: FADE_DURATION,
      useNativeDriver: true,
    }).start();
  }, [visible, overlayOpacity]);

  // Pulsing recording indicator
  useEffect(() => {
    if (!visible) return;

    const dotColor = status === 'recording' && accuracy != null ? 'green' : 'grey';
    if (status === 'paused' || dotColor === 'grey') {
      pulseAnim.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, status, accuracy, pulseAnim]);

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
        const clamped = Math.max(0, Math.min(gesture.dx, UNLOCK_THRESHOLD));
        translateX.setValue(clamped);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx >= UNLOCK_THRESHOLD) {
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

  const labelOpacity = translateX.interpolate({
    inputRange: [0, UNLOCK_THRESHOLD * 0.5],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  // Recording status indicator
  const isGpsMode = mode === 'gps';
  const hasGps = accuracy != null;
  const dotColor = status === 'paused' ? '#F59E0B' : hasGps ? '#22C55E' : '#9CA3AF';
  const gpsStatusText = !isGpsMode
    ? null
    : hasGps
      ? null
      : t('recording.gpsAcquiring', 'Acquiring GPS...');

  return (
    <Animated.View
      testID="lock-overlay"
      style={[styles.overlay, { opacity: overlayOpacity }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {/* Block all touches except the slider */}
      <View style={styles.touchBlocker} pointerEvents="box-only" />

      {/* Recording indicator + GPS status */}
      <View style={styles.statusRow}>
        <Animated.View
          style={[styles.statusDot, { backgroundColor: dotColor, opacity: pulseAnim }]}
        />
        {isGpsMode && <GpsSignalIndicator accuracy={accuracy} />}
        {gpsStatusText && <Text style={styles.gpsAcquiringText}>{gpsStatusText}</Text>}
      </View>

      {/* Elapsed time */}
      <Text style={styles.elapsed}>{elapsed}</Text>

      {/* Distance */}
      <Text style={styles.distance}>{distance}</Text>

      {/* Speed + HR row */}
      {(speed || heartrate) && (
        <View style={styles.dataRow}>
          {speed && (
            <View style={styles.dataCell}>
              <Text style={styles.dataValue}>{speed}</Text>
              <Text style={styles.dataLabel}>{t('recording.fields.speed', 'Speed')}</Text>
            </View>
          )}
          {heartrate != null && heartrate > 0 && (
            <View style={styles.dataCell}>
              <Text style={styles.dataValue}>{heartrate}</Text>
              <Text style={styles.dataLabel}>{t('recording.fields.heartrate', 'Heart Rate')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Mini-map (GPS mode) or activity icon (indoor mode) */}
      {isGpsMode ? (
        <View style={styles.miniMapContainer} pointerEvents="none">
          <RecordingMap
            coordinates={coordinates}
            currentLocation={currentLocation}
            style={styles.miniMap}
          />
        </View>
      ) : (
        <View style={styles.indoorIcon}>
          <MaterialCommunityIcons
            name={activityType ? getActivityIcon(activityType) : 'timer-outline'}
            size={48}
            color="rgba(255,255,255,0.4)"
          />
        </View>
      )}

      {/* Slide-to-unlock track */}
      <View style={styles.trackContainer}>
        <View style={styles.track}>
          <Animated.Text style={[styles.trackLabel, { opacity: labelOpacity }]}>
            {t('recording.slideToUnlock', 'Slide to unlock')}
          </Animated.Text>
          <Animated.View
            testID="lock-overlay-unlock"
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.70)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  touchBlocker: {
    ...StyleSheet.absoluteFillObject,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  gpsAcquiringText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
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
    marginBottom: spacing.sm,
  },
  dataRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginBottom: spacing.md,
  },
  dataCell: {
    alignItems: 'center',
  },
  dataValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  dataLabel: {
    fontSize: 11,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  miniMapContainer: {
    width: SCREEN_WIDTH * 0.6,
    height: SCREEN_WIDTH * 0.45,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  miniMap: {
    flex: 1,
  },
  indoorIcon: {
    marginBottom: spacing.xl,
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
