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
  iconSize,
  layout,
  spacing,
  recording,
  stroke,
  themePalette,
  typography,
} from '@/theme';
import type { RecordingStatus, RecordingMode } from '@/types';
import { mainButtonRole, type MainButtonRole } from '../lib/mainButtonRole';
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
  const role = mainButtonRole(status, mode);

  // Start, pause, resume, lap and finish are a change of state, since a
  // finished ride opens review and can still be resumed from there. A manual
  // save commits the entry, and review only navigates, which takes none.
  const changeState = useCallback((action: () => void) => {
    haptics.selection();
    action();
  }, []);
  const save = useCallback((action: () => void) => {
    haptics.success();
    action();
  }, []);

  // Manual mode: just a save button
  if (mode === 'manual') {
    return (
      <View style={[styles.bar, style]}>
        <Animated.View style={styles.centerGroup}>
          <PrimaryButton
            testID="control-save"
            label={t('recording.controls.save')}
            icon="content-save"
            role={role}
            onPress={() => save(onStop)}
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
            role={role}
            onPress={() => changeState(onStart)}
          />
        </Animated.View>
      </View>
    );
  }

  // Stopped: [REVIEW]. Back from review lands here, and a stopped ride takes no
  // lap, pause or finish, so the only way on is back to the screen that saves it.
  if (status === 'stopped') {
    return (
      <View style={[styles.bar, style]}>
        <Animated.View style={styles.centerGroup}>
          <PrimaryButton
            testID="control-review"
            label={t('recording.reviewActivity')}
            icon="clipboard-check-outline"
            role={role}
            onPress={onReview}
          />
        </Animated.View>
      </View>
    );
  }

  // Paused: [RESUME] [FINISH]
  if (status === 'paused') {
    return (
      <View style={[styles.bar, style]}>
        <View style={styles.buttonGroup}>
          <PrimaryButton
            testID="control-resume"
            label={t('recording.controls.resume')}
            icon="play"
            role={role}
            onPress={() => changeState(onResume)}
          />

          <SideButton
            testID="control-stop"
            label={t('recording.controls.finish')}
            icon="stop"
            onPress={() => changeState(onStop)}
          />
        </View>
      </View>
    );
  }

  // Recording: [LAP] [PAUSE] [FINISH]
  return (
    <View style={[styles.bar, style]}>
      <View style={styles.buttonGroup}>
        <SideButton
          testID="control-lap"
          label={t('recording.controls.lap')}
          icon="flag-variant"
          onPress={() => changeState(onLap)}
        />

        <PrimaryButton
          testID="control-pause"
          label={t('recording.controls.pause')}
          icon="pause"
          role={role}
          onPress={() => changeState(onPause)}
        />

        <SideButton
          testID="control-stop"
          label={t('recording.controls.finish')}
          icon="stop"
          onPress={() => changeState(onStop)}
        />
      </View>
    </View>
  );
}

// The one main button: the record red when it begins recording, the action
// blue when it acts on a ride already begun. White carries on both at the text
// bar in both themes.
function PrimaryButton({
  label,
  icon,
  role,
  onPress,
  testID,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  role: MainButtonRole;
  onPress: () => void;
  testID?: string;
}) {
  const { isDark } = useTheme();
  const fill =
    role === 'record'
      ? isDark
        ? recording.dark
        : recording.light
      : themePalette(isDark).actionPrimary;
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

// A side control, Lap or Finish: neutral, on the raised ground with the
// control edge, so the main button stays the one fill on the bar.
function SideButton({
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
  const palette = themePalette(isDark);
  return (
    <View style={styles.buttonContainer}>
      <PressTarget
        testID={testID}
        style={[
          styles.sideButton,
          {
            backgroundColor: palette.surfaceRaised,
            borderColor: palette.controlBoundary,
            borderWidth: stroke.one,
          },
        ]}
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <Icon name={icon} size={iconSize.lg} color={palette.textPrimary} />
      </PressTarget>
      <Text style={[styles.buttonLabel, { color: palette.textPrimary }]}>{label}</Text>
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
  sideButton: {
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
