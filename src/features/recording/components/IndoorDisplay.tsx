import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { getActivityIcon, getActivityColor } from '@/shared/activity/activityUtils';
import type { ActivityType } from '@/types';
import { styles } from '../RecordingScreen.styles';
import { useTimer } from '../hooks/useTimer';

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
  const activityColor = getActivityColor(activityType);
  const { formattedMoving } = useTimer();
  return (
    <View style={[styles.indoorDisplay, { backgroundColor: surface, borderColor: border }]}>
      <MaterialCommunityIcons
        name={getActivityIcon(activityType)}
        size={48}
        color={activityColor}
      />
      <Text style={[styles.indoorTimer, { color: textPrimary }]}>{formattedMoving}</Text>
    </View>
  );
}
