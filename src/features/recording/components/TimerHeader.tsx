import { View, TouchableOpacity, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors } from '@/theme';
import { getActivityIcon, getActivityColor } from '@/features/activity/lib/activityUtils';
import type { ActivityType } from '@/types';
import type { RecordingMode, RecordingStatus } from '../types';
import { GpsSignalIndicator } from './GpsSignalIndicator';
import { styles } from '../RecordingScreen.styles';

export function TimerHeader({
  formattedElapsed,
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
  formattedElapsed: string;
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

  return (
    <View style={styles.timerHeader}>
      <View>
        <Text
          testID="recording-timer"
          style={[styles.timerText, { color: textPrimary }, autoPaused && styles.timerPaused]}
        >
          {formattedElapsed}
        </Text>
        {autoPaused && (
          <Text
            testID="recording-autopause"
            style={[styles.autoPauseLabel, { color: textSecondary }]}
          >
            {t('recording.autoPaused')} · {t('recording.autoPausedHint')}
          </Text>
        )}
      </View>
      <View style={styles.headerRight}>
        <TouchableOpacity
          testID="recording-type-badge"
          style={[styles.typeBadge, { borderColor: border }]}
          onPress={onOpenTypePicker}
          activeOpacity={0.7}
          disabled={isLocked}
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
        </TouchableOpacity>
        <View style={styles.statusRow}>
          <TouchableOpacity
            testID="recording-lock-toggle"
            style={styles.lockChip}
            onPress={onLock}
            disabled={isLocked}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('recording.slideToUnlock', 'Slide to unlock')}
          >
            <MaterialCommunityIcons
              name={isLocked ? 'lock' : 'lock-open-variant-outline'}
              size={16}
              color={textSecondary}
            />
          </TouchableOpacity>
          <View testID="recording-status" style={styles.statusBadge}>
            <Animated.View
              style={[
                styles.statusDot,
                {
                  backgroundColor: status === 'recording' ? colors.error : colors.warning,
                  opacity: statusPulse,
                },
              ]}
            />
            <Text style={[styles.statusText, { color: textSecondary }]}>
              {status === 'recording' ? t('recording.rec', 'REC') : t('recording.paused', 'PAUSED')}
            </Text>
            {mode === 'gps' && <GpsSignalIndicator accuracy={accuracy} />}
          </View>
        </View>
      </View>
    </View>
  );
}
