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
  textPrimary,
  textSecondary,
  border,
  onOpenTypePicker,
}: {
  formattedElapsed: string;
  currentActivityType: ActivityType;
  status: RecordingStatus;
  statusPulse: Animated.Value;
  mode: RecordingMode;
  accuracy: number | null;
  textPrimary: string;
  textSecondary: string;
  border: string;
  onOpenTypePicker: () => void;
}) {
  const { t } = useTranslation();
  const currentActivityColor = getActivityColor(currentActivityType);

  return (
    <View style={styles.timerHeader}>
      <Text testID="recording-timer" style={[styles.timerText, { color: textPrimary }]}>
        {formattedElapsed}
      </Text>
      <View style={styles.headerRight}>
        {/* Activity type badge */}
        <TouchableOpacity
          testID="recording-type-badge"
          style={[styles.typeBadge, { borderColor: border }]}
          onPress={onOpenTypePicker}
          activeOpacity={0.7}
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
        {/* Status badge */}
        <View testID="recording-status" style={styles.statusBadge}>
          <Animated.View
            style={[
              styles.statusDot,
              {
                backgroundColor: status === 'recording' ? colors.error : '#F59E0B',
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
  );
}
