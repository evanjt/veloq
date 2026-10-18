import { View } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { sportMarkColour } from '@/shared/activity/sportCategories';
import type { ActivityType } from '@/types';
import { styles } from '../RecordingScreen.styles';
import { useTimer } from '../hooks/useTimer';

import { iconSize } from '@/theme';
import { Icon } from '@/shared/ui/Icon';
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
  const activityColor = sportMarkColour(activityType, isDark);
  const { formattedMoving } = useTimer();
  return (
    <View style={[styles.indoorDisplay, { backgroundColor: surface, borderColor: border }]}>
      <Icon name={getActivityIcon(activityType)} size={iconSize.xxl} color={activityColor} />
      <Text style={[styles.indoorTimer, { color: textPrimary }]}>{formattedMoving}</Text>
    </View>
  );
}
