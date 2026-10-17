import React from 'react';
import { View, Pressable, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, iconSize, recording } from '@/theme';
import { IconButton } from '@/shared/ui/IconButton';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { useTheme } from '@/shared/app';
import { getActivityIcon, getActivityInk } from '@/shared/activity/activityUtils';
import type { ActivityType } from '@/types';
import type { RecordingMode, RecordingStatus } from '../types';
import { GpsSignalIndicator } from './GpsSignalIndicator';
import { RecordingCloseButton } from './RecordingCloseButton';
import { styles } from '../RecordingScreen.styles';
import { useTimer } from '../hooks/useTimer';

/** The clock reads in the secondary ink while auto-pause holds it, and in the primary ink otherwise. */
function ElapsedTime({ color }: { color: string }) {
  const { formattedElapsed } = useTimer();
  return (
    <Text
      testID="recording-timer"
      maxFontSizeMultiplier={DENSE_TEXT_SCALE}
      style={[styles.timerText, { color }]}
    >
      {formattedElapsed}
    </Text>
  );
}

function TimerHeaderInner({
  currentActivityType,
  status,
  statusPulse,
  mode,
  accuracy,
  autoPaused,
  isLocked,
  textPrimary,
  textSecondary,
  border,
  onOpenTypePicker,
  onLock,
}: {
  currentActivityType: ActivityType;
  status: RecordingStatus;
  statusPulse: Animated.Value;
  mode: RecordingMode;
  accuracy: number | null;
  autoPaused: boolean;
  isLocked: boolean;
  textPrimary: string;
  textSecondary: string;
  border: string;
  onOpenTypePicker: () => void;
  onLock: () => void;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const currentActivityColor = getActivityInk(currentActivityType, isDark);
  const statusSpoken = status === 'recording' ? t('spoken.rec') : t('recording.paused', 'Paused');
  // The phone is mounted or pocketed during a ride, so a change of state is
  // spoken: through the live regions below on Android, announced on iOS.
  // Nothing is recording on the screen waiting for Start, so it says nothing.
  let announcement: string | null = null;
  if (status !== 'idle') {
    announcement = autoPaused
      ? `${t('recording.autoPaused')}. ${t('recording.autoPausedHint')}`
      : statusSpoken;
  }
  useAnnounceOnAppear(announcement);

  return (
    <View style={styles.timerHeader}>
      <View>
        {status === 'idle' && <RecordingCloseButton />}
        <ElapsedTime color={autoPaused ? textSecondary : textPrimary} />
        {autoPaused ? (
          <Text
            testID="recording-autopause"
            style={[styles.autoPauseLabel, { color: textSecondary }]}
            accessibilityLiveRegion="polite"
          >
            {t('recording.autoPaused')} · {t('recording.autoPausedHint')}
          </Text>
        ) : null}
      </View>
      <View style={styles.headerRight}>
        <Pressable
          testID="recording-type-badge"
          style={pressable([styles.typeBadge, { borderColor: border }])}
          android_ripple={pressRipple}
          onPress={onOpenTypePicker}
          disabled={isLocked}
          accessibilityRole="button"
          accessibilityHint={t('recording.changeType')}
        >
          <MaterialCommunityIcons
            name={getActivityIcon(currentActivityType)}
            size={iconSize.sm}
            color={currentActivityColor}
          />
          <Text style={[styles.typeBadgeText, { color: textSecondary }]} numberOfLines={1}>
            {t(`activityTypes.${currentActivityType}`, currentActivityType)}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={iconSize.sm} color={textSecondary} />
        </Pressable>
        <View style={styles.statusRow}>
          <IconButton
            testID="recording-lock-toggle"
            style={styles.lockChip}
            onPress={onLock}
            disabled={isLocked}
            accessibilityLabel={t('recording.lockControls')}
          >
            <MaterialCommunityIcons
              name={isLocked ? 'lock' : 'lock-open-variant-outline'}
              size={iconSize.sm}
              color={textSecondary}
            />
          </IconButton>
          {/* Nothing is recording on a screen waiting for Start, and a badge
              reading PAUSED there would mislead. The
              GPS indicator goes with it: no watch runs while idle. */}
          {status !== 'idle' && (
            <View
              testID="recording-status"
              style={styles.statusBadge}
              accessibilityLiveRegion="polite"
            >
              <Animated.View
                testID="recording-status-dot"
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      status === 'recording'
                        ? recording[isDark ? 'dark' : 'light']
                        : colors.warning,
                    opacity: statusPulse,
                  },
                ]}
              />
              <Text
                style={[styles.statusText, { color: textSecondary }]}
                accessibilityLabel={statusSpoken}
              >
                {status === 'recording'
                  ? t('recording.rec', 'REC')
                  : t('recording.paused', 'Paused')}
              </Text>
              {mode === 'gps' && <GpsSignalIndicator accuracy={accuracy} />}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

export const TimerHeader = React.memo(TimerHeaderInner);
