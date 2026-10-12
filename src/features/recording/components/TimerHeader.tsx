import React from 'react';
import { View, Pressable, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors } from '@/theme';
import { IconButton } from '@/shared/ui/IconButton';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { getActivityIcon, getActivityColor } from '@/shared/activity/activityUtils';
import type { ActivityType } from '@/types';
import type { RecordingMode, RecordingStatus } from '../types';
import { GpsSignalIndicator } from './GpsSignalIndicator';
import { RecordingCloseButton } from './RecordingCloseButton';
import { styles } from '../RecordingScreen.styles';
import { useTimer } from '../hooks/useTimer';

function ElapsedTime({ textPrimary, autoPaused }: { textPrimary: string; autoPaused: boolean }) {
  const { formattedElapsed } = useTimer();
  return (
    <Text
      testID="recording-timer"
      style={[styles.timerText, { color: textPrimary }, autoPaused && styles.timerPaused]}
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
  const currentActivityColor = getActivityColor(currentActivityType);
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
        <ElapsedTime textPrimary={textPrimary} autoPaused={autoPaused} />
        {autoPaused && (
          <Text
            testID="recording-autopause"
            style={[styles.autoPauseLabel, { color: textSecondary }]}
            accessibilityLiveRegion="polite"
          >
            {t('recording.autoPaused')} · {t('recording.autoPausedHint')}
          </Text>
        )}
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
            size={16}
            color={currentActivityColor}
          />
          <Text style={[styles.typeBadgeText, { color: textSecondary }]} numberOfLines={1}>
            {t(`activityTypes.${currentActivityType}`, currentActivityType)}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={14} color={textSecondary} />
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
              size={16}
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
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: status === 'recording' ? colors.error : colors.warning,
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
                  : t('recording.paused', 'PAUSED')}
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
