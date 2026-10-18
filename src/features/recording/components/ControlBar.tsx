import React, { useCallback } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import type { ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as haptics from '@/shared/ui/haptics';

import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  spacing,
  recording,
  themePalette,
  typography,
} from '@/theme';
import type { RecordingStatus, RecordingMode } from '@/types';
import { Icon } from '@/shared/ui/Icon';
import { PressTarget } from '@/shared/ui/PressTarget';

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

  // Ending the ride runs without a confirm, so it alone takes the strong
  // impact. Lap, pause, resume and start are a change of state, and review
  // only navigates, which takes none.
  const endRide = useCallback((action: () => void) => {
    haptics.medium();
    action();
  }, []);
  const changeState = useCallback((action: () => void) => {
    haptics.selection();
    action();
  }, []);

  const secondaryBg = isDark ? darkColors.surfaceRaised : colors.surface;
  const secondaryText = isDark ? darkColors.textPrimary : colors.textPrimary;
  // Stop is a word as well as a glyph, so it takes the red's text tone.
  const stopColor = isDark ? darkColors.errorText : colors.errorText;

  // Manual mode: just a save button
  if (mode === 'manual') {
    return (
      <View style={[styles.bar, style]}>
        <Animated.View style={styles.centerGroup}>
          <PrimaryButton
            testID="control-save"
            label={t('recording.controls.save')}
            icon="content-save"
            onPress={() => endRide(onStop)}
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
            onPress={() => changeState(onStart)}
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
            onPress={onReview}
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
            onPress={() => changeState(onResume)}
          />

          <SecondaryButton
            testID="control-stop"
            label={t('recording.controls.stop')}
            icon="stop"
            backgroundColor={secondaryBg}
            textColor={stopColor}
            onPress={() => endRide(onStop)}
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
          onPress={() => changeState(onLap)}
        />

        <PrimaryButton
          testID="control-pause"
          label={t('recording.controls.pause')}
          icon="pause"
          onPress={() => changeState(onPause)}
        />

        <SecondaryButton
          testID="control-stop"
          label={t('recording.controls.stop')}
          icon="stop"
          backgroundColor={secondaryBg}
          textColor={stopColor}
          onPress={() => endRide(onStop)}
        />
      </View>
    </View>
  );
}

// The one main button in every state takes the record red, whatever it does,
// so the screen's own action reads as the same control as the button that
// opened it. White carries on both tones at the text bar.
function PrimaryButton({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  onPress: () => void;
  testID?: string;
}) {
  const { isDark } = useTheme();
  const fill = isDark ? recording.dark : recording.light;
  return (
    <View style={styles.buttonContainer}>
      <PressTarget
        testID={testID}
        style={[styles.primaryButton, { backgroundColor: fill }]}
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <Icon name={icon} size={iconSize.xl} color={colors.textOnFill} />
      </PressTarget>
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
      <PressTarget
        testID={testID}
        style={[styles.secondaryButton, { backgroundColor }]}
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <Icon name={icon} size={iconSize.lg} color={textColor} />
      </PressTarget>
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
    borderRadius: layout.borderRadiusFull,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonLabel: {
    ...typography.badge,
  },
});
