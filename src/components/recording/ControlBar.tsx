import React, { useRef, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import type { ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, layout } from '@/theme';
import type { RecordingStatus, RecordingMode } from '@/types';

const BRAND_COLOR = '#FC4C02';
const RESUME_COLOR = '#22C55E';
const STOP_COLOR = '#EF4444';
const LONG_PRESS_MS = 3000;

interface ControlBarProps {
  status: RecordingStatus;
  mode: RecordingMode;
  onLap: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onLock: () => void;
  style?: ViewStyle;
}

function ControlBarInner({
  status,
  mode,
  onLap,
  onPause,
  onResume,
  onStop,
  onLock,
  style,
}: ControlBarProps) {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();

  // Long-press stop state
  const [stopProgress, setStopProgress] = useState(0);
  const stopTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopStartRef = useRef<number | null>(null);
  const stopAnim = useRef(new Animated.Value(0)).current;

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current) {
      clearInterval(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    stopStartRef.current = null;
    setStopProgress(0);
    stopAnim.setValue(0);
  }, [stopAnim]);

  // Clean up on unmount
  useEffect(() => clearStopTimer, [clearStopTimer]);

  const handleStopPressIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    stopStartRef.current = Date.now();
    stopTimerRef.current = setInterval(() => {
      if (!stopStartRef.current) return;
      const elapsed = Date.now() - stopStartRef.current;
      const progress = Math.min(elapsed / LONG_PRESS_MS, 1);
      setStopProgress(progress);
      if (progress >= 1) {
        clearStopTimer();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onStop();
      }
    }, 50);

    Animated.timing(stopAnim, {
      toValue: 1,
      duration: LONG_PRESS_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [onStop, clearStopTimer, stopAnim]);

  const handleStopPressOut = useCallback(() => {
    clearStopTimer();
  }, [clearStopTimer]);

  const handleHapticPress = useCallback((action: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    action();
  }, []);

  const secondaryBg = isDark ? darkColors.surfaceElevated : colors.backgroundAlt;
  const secondaryText = isDark ? darkColors.textPrimary : colors.textSecondary;

  // Manual mode: just a save button
  if (mode === 'manual') {
    return (
      <View style={[styles.bar, style]}>
        <Animated.View style={styles.centerGroup}>
          <PrimaryButton
            label={t('recording.controls.save')}
            icon="content-save"
            color={BRAND_COLOR}
            onPress={() => handleHapticPress(onStop)}
          />
        </Animated.View>
      </View>
    );
  }

  // Paused: [RESUME] [STOP (long-press)]
  if (status === 'paused') {
    const stopBorderColor = stopAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['rgba(239,68,68,0.3)', STOP_COLOR],
    });

    return (
      <View style={[styles.bar, style]}>
        <View style={styles.buttonGroup}>
          <PrimaryButton
            label={t('recording.controls.resume')}
            icon="play"
            color={RESUME_COLOR}
            onPress={() => handleHapticPress(onResume)}
          />

          <Animated.View
            style={[styles.stopButtonWrap, { borderColor: stopBorderColor }]}
            onTouchStart={handleStopPressIn}
            onTouchEnd={handleStopPressOut}
            onTouchCancel={handleStopPressOut}
          >
            <View style={[styles.stopButton, { backgroundColor: secondaryBg }]}>
              {/* Progress overlay */}
              <View
                style={[
                  styles.stopProgress,
                  {
                    backgroundColor: STOP_COLOR,
                    width: `${stopProgress * 100}%` as `${number}%`,
                  },
                ]}
              />
              <View style={styles.stopContent}>
                <MaterialCommunityIcons name="stop" size={22} color={STOP_COLOR} />
                <Text style={[styles.stopLabel, { color: STOP_COLOR }]}>
                  {t('recording.controls.stop')}
                </Text>
              </View>
            </View>
          </Animated.View>
        </View>
      </View>
    );
  }

  // Recording: [LAP] [PAUSE] [LOCK]
  return (
    <View style={[styles.bar, style]}>
      <View style={styles.buttonGroup}>
        <SecondaryButton
          label={t('recording.controls.lap')}
          icon="flag-variant"
          backgroundColor={secondaryBg}
          textColor={secondaryText}
          onPress={() => handleHapticPress(onLap)}
        />

        <PrimaryButton
          label={t('recording.controls.pause')}
          icon="pause"
          color={BRAND_COLOR}
          onPress={() => handleHapticPress(onPause)}
        />

        <SecondaryButton
          label={t('recording.controls.lock')}
          icon="lock"
          backgroundColor={secondaryBg}
          textColor={secondaryText}
          onPress={() => handleHapticPress(onLock)}
        />
      </View>
    </View>
  );
}

// Primary circular action button
function PrimaryButton({
  label,
  icon,
  color,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  color: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.buttonContainer}>
      <View
        style={[styles.primaryButton, { backgroundColor: color }]}
        onTouchEnd={onPress}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons name={icon} size={28} color="#FFFFFF" />
      </View>
      <Text style={styles.buttonLabel}>{label}</Text>
    </View>
  );
}

// Secondary action button
function SecondaryButton({
  label,
  icon,
  backgroundColor,
  textColor,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  backgroundColor: string;
  textColor: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.buttonContainer}>
      <View
        style={[styles.secondaryButton, { backgroundColor }]}
        onTouchEnd={onPress}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons name={icon} size={22} color={textColor} />
      </View>
      <Text style={[styles.buttonLabel, { color: textColor }]}>{label}</Text>
    </View>
  );
}

export const ControlBar = React.memo(ControlBarInner);

const styles = StyleSheet.create({
  bar: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  centerGroup: {
    alignItems: 'center',
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
  },
  buttonContainer: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  primaryButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  // Stop button with long-press progress
  stopButtonWrap: {
    borderRadius: 14,
    borderWidth: 2,
    overflow: 'hidden',
  },
  stopButton: {
    height: 56,
    minWidth: 120,
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopProgress: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    opacity: 0.15,
  },
  stopContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  stopLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
