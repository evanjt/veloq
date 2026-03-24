import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import ReAnimated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { Text } from 'react-native-paper';
import { usePathname } from 'expo-router';
import { navigateTo } from '@/lib';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { useRecordingStore } from '@/providers/RecordingStore';
import { formatDistance, formatDuration } from '@/lib';
import { colors, darkColors, spacing } from '@/theme';

const BRAND_COLOR = '#EF4444';

function RecordingBannerInner() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const status = useRecordingStore((s) => s.status);
  const activityType = useRecordingStore((s) => s.activityType);
  const startTime = useRecordingStore((s) => s.startTime);
  const pausedDuration = useRecordingStore((s) => s.pausedDuration);
  const streams = useRecordingStore((s) => s.streams);
  const _pauseStart = useRecordingStore((s) => s._pauseStart);

  const [elapsed, setElapsed] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Update elapsed time every second
  useEffect(() => {
    if (status !== 'recording' && status !== 'paused') return;
    if (!startTime) return;

    const tick = () => {
      const now = Date.now();
      const currentPausedMs = status === 'paused' && _pauseStart ? now - _pauseStart : 0;
      const totalElapsed = (now - startTime - pausedDuration - currentPausedMs) / 1000;
      setElapsed(Math.max(0, totalElapsed));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status, startTime, pausedDuration, _pauseStart]);

  // Pulse animation for red dot when recording
  useEffect(() => {
    if (status === 'recording') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status, pulseAnim]);

  if (status !== 'recording' && status !== 'paused') return null;
  if (pathname.startsWith('/recording')) return null;

  const distance = streams.distance[streams.distance.length - 1] ?? 0;
  const typeLabel = activityType ?? '';

  const handlePress = () => {
    if (activityType) {
      navigateTo(`/recording/${activityType}`);
    }
  };

  return (
    <ReAnimated.View entering={SlideInUp.duration(250)} exiting={SlideOutUp.duration(200)}>
      <TouchableOpacity
        style={[
          styles.banner,
          { backgroundColor: isDark ? darkColors.surface : colors.surface, paddingTop: insets.top },
          isDark && styles.bannerDark,
        ]}
        onPress={handlePress}
        activeOpacity={0.7}
        accessibilityLabel={t('recording.banner.returnToRecording')}
        accessibilityRole="button"
      >
        <View style={styles.topRow}>
          <Animated.View style={[styles.dot, { opacity: pulseAnim }]} />
          <Text style={[styles.timer, { color: themeColors.text }]}>{formatDuration(elapsed)}</Text>
          <Text style={[styles.statusText, { color: themeColors.textSecondary }]}>
            {status === 'paused' ? t('recording.status.paused') : t('recording.status.recording')}
          </Text>
        </View>
        <View style={styles.bottomRow}>
          <Text style={[styles.detailText, { color: themeColors.textMuted }]}>
            {typeLabel}
            {distance > 0 ? ` \u00B7 ${formatDistance(distance)}` : ''}
          </Text>
        </View>
      </TouchableOpacity>
    </ReAnimated.View>
  );
}

export const RecordingBanner = React.memo(RecordingBannerInner);

const styles = StyleSheet.create({
  banner: {
    height: 56,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bannerDark: {
    borderBottomColor: darkColors.border,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BRAND_COLOR,
  },
  timer: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statusText: {
    fontSize: 14,
    fontWeight: '400',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 16, // align with text after dot
  },
  detailText: {
    fontSize: 12,
    fontWeight: '400',
  },
});
