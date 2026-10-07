import React, { useCallback } from 'react';
import { View, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import type { ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, brand, typography } from '@/theme';
import type { RecordingStatus, RecordingMode } from '@/types';

const BRAND_COLOR = brand.tealLight;
const RESUME_COLOR = colors.success;
const STOP_COLOR = colors.error;

interface ControlBarProps {
  status: RecordingStatus;
  mode: RecordingMode;
  onLap: () => void;
  onPause: () => void;
  onResume: () => void;
  onStart: () => void;
  onStop: () => void;
  /** Open review for a ride already stopped, the one thing left to do with it. */
  onReview: () => void;
  style?: ViewStyle;
}

function ControlBarInner({
  status,
  mode,
  onLap,
  onPause,
  onResume,
  onStart,
  onStop,
  onReview,
  style,
}: ControlBarProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

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

  // Idle: [START]. The screen is reached with nothing recording from a one-tap
  // system entry, and the athlete begins when they are ready.
  if (status === 'idle') {
    return (
      <View style={[styles.bar, style]}>
        <Animated.View style={styles.centerGroup}>
          <PrimaryButton
            testID="control-start"
            label={t('recording.startActivity')}
            icon="play"
            color={RESUME_COLOR}
            onPress={() => handleHapticPress(onStart)}
          />
        </Animated.View>
      </View>
    );
  }

  // Stopped: [REVIEW]. Back from review lands here, and a stopped ride takes no
  // lap, pause or stop, so the only way on is back to the screen that saves it.
  if (status === 'stopped') {
    return (
      <View style={[styles.bar, style]}>
        <Animated.View style={styles.centerGroup}>
          <PrimaryButton
            testID="control-review"
            label={t('recording.reviewActivity')}
            icon="clipboard-check-outline"
            color={BRAND_COLOR}
            onPress={() => handleHapticPress(onReview)}
          />
        </Animated.View>
      </View>
    );
  }

  // Paused: [RESUME] [STOP]
  if (status === 'paused') {
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
        <MaterialCommunityIcons name={icon} size={28} color={colors.textOnDark} />
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
    borderRadius: layout.borderRadiusFull,
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
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
