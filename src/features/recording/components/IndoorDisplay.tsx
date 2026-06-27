import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { getActivityIcon, getActivityColor } from '@/features/activity/lib/activityUtils';
import type { ActivityType } from '@/types';
import { styles } from '../RecordingScreen.styles';

export function IndoorDisplay({
  activityType,
  formattedMoving,
  surface,
  border,
  textPrimary,
}: {
  activityType: ActivityType;
  formattedMoving: string;
  surface: string;
  border: string;
  textPrimary: string;
}) {
  const activityColor = getActivityColor(activityType);
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
