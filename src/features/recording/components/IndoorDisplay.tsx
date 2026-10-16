import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { getActivityIcon, getActivityInk } from '@/shared/activity/activityUtils';
import type { ActivityType } from '@/types';
import { styles } from '../RecordingScreen.styles';
import { useTimer } from '../hooks/useTimer';

import { iconSize } from '@/theme';
export function IndoorDisplay({
  activityType,
  surface,
  border,
  textPrimary,
}: {
  activityType: ActivityType;
  surface: string;
  border: string;
  textPrimary: string;
}) {
  const { isDark } = useTheme();
  const activityColor = getActivityInk(activityType, isDark);
  const { formattedMoving } = useTimer();
  return (
    <View style={[styles.indoorDisplay, { backgroundColor: surface, borderColor: border }]}>
      <MaterialCommunityIcons
        name={getActivityIcon(activityType)}
        size={iconSize.xxl}
        color={activityColor}
      />
      <Text style={[styles.indoorTimer, { color: textPrimary }]}>{formattedMoving}</Text>
    </View>
  );
}
