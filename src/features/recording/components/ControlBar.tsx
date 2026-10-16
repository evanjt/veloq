import React, { useCallback } from 'react';
import { View, StyleSheet, Animated, Pressable } from 'react-native';
import type { ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as haptics from '@/shared/ui/haptics';

import { useTheme } from '@/shared/app';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import {
  brand,
  colors,
  darkColors,
  iconSize,
  layout,
  spacing,
  themePalette,
  typography,
} from '@/theme';
import type { RecordingStatus, RecordingMode } from '@/types';

// Each round button's fill with the ink its glyph takes on it.
const BRAND_FILL = { fill: brand.tealLight, ink: colors.textOnPrimary };
const RESUME_FILL = { fill: colors.success, ink: colors.textOnBright };

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
    haptics.medium();
    action();
  }, []);

  const secondaryBg = isDark ? darkColors.surfaceElevated : colors.surface;
  const secondaryText = isDark ? darkColors.textPrimary : colors.textPrimary;
  // Stop is a word as well as a glyph, so it takes the red's text tone.
  const stopColor = isDark ? darkColors.errorDeep : colors.errorDeep;

  // Manual mode: just a save button
  if (mode === 'manual') {
    return (
      <View style={[styles.bar, style]}>
        <Animated.View style={styles.centerGroup}>
          <PrimaryButton
            testID="control-save"
            label={t('recording.controls.save')}
            icon="content-save"
            paint={BRAND_FILL}
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
            paint={RESUME_FILL}
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
            paint={BRAND_FILL}
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
            paint={RESUME_FILL}
            onPress={() => handleHapticPress(onResume)}
          />

          <SecondaryButton
            testID="control-stop"
            label={t('recording.controls.stop')}
            icon="stop"
            backgroundColor={secondaryBg}
            textColor={stopColor}
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
          paint={BRAND_FILL}
          onPress={() => handleHapticPress(onPause)}
        />

        <SecondaryButton
          testID="control-stop"
          label={t('recording.controls.stop')}
          icon="stop"
          backgroundColor={secondaryBg}
          textColor={stopColor}
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
  paint,
  onPress,
  testID,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  paint: { fill: string; ink: string };
  onPress: () => void;
  testID?: string;
}) {
  const { isDark } = useTheme();
  return (
    <View style={styles.buttonContainer}>
      <Pressable
        testID={testID}
        style={pressable([styles.primaryButton, { backgroundColor: paint.fill }])}
        android_ripple={pressRipple}
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons name={icon} size={iconSize.xl} color={paint.ink} />
      </Pressable>
      <Text style={[styles.buttonLabel, { color: themePalette(isDark).textSecondary }]}>
        {label}
      </Text>
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
      <Pressable
        testID={testID}
        style={pressable([styles.secondaryButton, { backgroundColor }])}
        android_ripple={pressRipple}
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons name={icon} size={iconSize.lg} color={textColor} />
      </Pressable>
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
  },
});
