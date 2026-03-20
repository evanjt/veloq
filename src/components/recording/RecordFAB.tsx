import React, { useEffect, useRef } from 'react';
import { StyleSheet, TouchableOpacity, Animated, View } from 'react-native';
import { Text } from 'react-native-paper';
import { usePathname } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { navigateTo } from '@/lib';
import { useRecordingStore } from '@/providers/RecordingStore';
import { useTheme } from '@/hooks';
import { formatDuration } from '@/lib';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { shadows, spacing } from '@/theme';

const FAB_SIZE = 56;
const BRAND_COLOR = '#FC4C02';

function RecordFABInner() {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const status = useRecordingStore((s) => s.status);
  const activityType = useRecordingStore((s) => s.activityType);
  const startTime = useRecordingStore((s) => s.startTime);
  const pausedDuration = useRecordingStore((s) => s.pausedDuration);
  const _pauseStart = useRecordingStore((s) => s._pauseStart);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [elapsed, setElapsed] = React.useState(0);

  const isRecording = status === 'recording' || status === 'paused';
  const isHidden = pathname.startsWith('/recording') || pathname === '/record';

  // Update elapsed time when recording
  useEffect(() => {
    if (!isRecording || !startTime) return;
    const tick = () => {
      const now = Date.now();
      const currentPausedMs = status === 'paused' && _pauseStart ? now - _pauseStart : 0;
      const totalElapsed = (now - startTime - pausedDuration - currentPausedMs) / 1000;
      setElapsed(Math.max(0, totalElapsed));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isRecording, status, startTime, pausedDuration, _pauseStart]);

  // Pulse animation when recording
  useEffect(() => {
    if (status === 'recording') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status, pulseAnim]);

  // Hide on recording screens and type picker — AFTER all hooks
  if (isHidden) return null;

  const handlePress = () => {
    if (isRecording && activityType) {
      navigateTo(`/recording/${activityType}`);
    } else {
      navigateTo('/record');
    }
  };

  const bottomOffset = insets.bottom + TAB_BAR_SAFE_PADDING + spacing.md;

  if (isRecording) {
    return (
      <TouchableOpacity
        testID="record-fab"
        style={[styles.recordingFab, { bottom: bottomOffset }, shadows.fab]}
        onPress={handlePress}
        activeOpacity={0.8}
        accessibilityLabel="Return to recording"
        accessibilityRole="button"
      >
        <Animated.View style={[styles.recordingDot, { opacity: pulseAnim }]} />
        <Text style={styles.recordingTimer}>{formatDuration(elapsed)}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      testID="record-fab"
      style={[styles.fab, { bottom: bottomOffset }, shadows.fab]}
      onPress={handlePress}
      activeOpacity={0.8}
      accessibilityLabel="Start recording"
      accessibilityRole="button"
    >
      <MaterialCommunityIcons name="record-circle-outline" size={26} color="#FFFFFF" />
    </TouchableOpacity>
  );
}

export const RecordFAB = React.memo(RecordFABInner);

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.md,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: BRAND_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  recordingFab: {
    position: 'absolute',
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: FAB_SIZE,
    paddingHorizontal: spacing.md,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: BRAND_COLOR,
    zIndex: 999,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  recordingTimer: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
});
