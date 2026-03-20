import React, { useRef, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Animated, Easing, TouchableOpacity } from 'react-native';
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
const LONG_PRESS_MS = 1000;

interface ControlBarProps {
  status: RecordingStatus;
  mode: RecordingMode;
  onLap: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard?: () => void;
  style?: ViewStyle;
}

function ControlBarInner({
  status,
  mode,
  onLap,
  onPause,
  onResume,
  onStop,
  onDiscard,
  style,
}: ControlBarProps) {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();

  // Long-press stop state — fully Animated, no React state re-renders
  const stopAnim = useRef(new Animated.Value(0)).current;
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    stopAnim.stopAnimation();
    stopAnim.setValue(0);
  }, [stopAnim]);

  useEffect(() => clearStopTimer, [clearStopTimer]);

  const handleStopPressIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Animated.timing(stopAnim, {
      toValue: 1,
      duration: LONG_PRESS_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    // Fire completion after duration
    stopTimerRef.current = setTimeout(() => {
      clearStopTimer();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onStop();
    }, LONG_PRESS_MS);
  }, [onStop, clearStopTimer, stopAnim]);

  const handleStopPressOut = useCallback(() => {
    clearStopTimer();
  }, [clearStopTimer]);

  const handleHapticPress = useCallback((action: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    action();
  }, []);

  const secondaryBg = isDark ? darkColors.surfaceElevated : colors.surface;
  const secondaryText = isDark ? darkColors.textPrimary : colors.textPrimary;

  // Manual mode: just a save button
  if (mode === 'manual') {
    return (
      <View style={[styles.bar, style]}>
        <Animated.View style={styles.centerGroup}>
          <PrimaryButton
            testID="control-save"
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
            testID="control-resume"
            label={t('recording.controls.resume')}
            icon="play"
            color={RESUME_COLOR}
            onPress={() => handleHapticPress(onResume)}
          />

          <Animated.View
            testID="control-stop"
            style={[styles.stopButtonWrap, { borderColor: stopBorderColor }]}
            onTouchStart={handleStopPressIn}
            onTouchEnd={handleStopPressOut}
            onTouchCancel={handleStopPressOut}
          >
            <View style={[styles.stopButton, { backgroundColor: secondaryBg }]}>
              {/* Progress overlay — driven by Animated for smooth 120hz */}
              <Animated.View
                style={[
                  styles.stopProgress,
                  {
                    backgroundColor: STOP_COLOR,
                    width: stopAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
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

  // Recording: [LAP] [PAUSE] [STOP]
  return (
    <View style={[styles.bar, style]}>
      <View style={styles.buttonGroup}>
        <SecondaryButton
          testID="control-lap"
          label={t('recording.controls.lap')}
          icon="flag-variant"
          backgroundColor={secondaryBg}
          textColor={secondaryText}
          onPress={() => handleHapticPress(onLap)}
        />

        <PrimaryButton
          testID="control-pause"
          label={t('recording.controls.pause')}
          icon="pause"
          color={BRAND_COLOR}
          onPress={() => handleHapticPress(onPause)}
        />

        <SecondaryButton
          testID="control-stop"
          label={t('recording.controls.stop')}
          icon="stop"
          backgroundColor={secondaryBg}
          textColor={STOP_COLOR}
          onPress={() => handleHapticPress(onStop)}
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
  testID,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  color: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.buttonContainer}>
      <TouchableOpacity
        testID={testID}
        style={[styles.primaryButton, { backgroundColor: color }]}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons name={icon} size={28} color="#FFFFFF" />
      </TouchableOpacity>
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
  testID,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  backgroundColor: string;
  textColor: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.buttonContainer}>
      <TouchableOpacity
        testID={testID}
        style={[styles.secondaryButton, { backgroundColor }]}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons name={icon} size={22} color={textColor} />
      </TouchableOpacity>
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
