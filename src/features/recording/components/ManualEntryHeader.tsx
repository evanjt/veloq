import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { ActivityType } from '@/types';
import { styles } from '../RecordingScreen.styles';

export function ManualEntryHeader({
  activityType,
  textPrimary,
}: {
  activityType: ActivityType;
  textPrimary: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.manualHeader}>
      <MaterialCommunityIcons
        name="arrow-left"
        size={24}
        color={textPrimary}
        onPress={() => router.back()}
        style={styles.manualBackBtn}
      />
      <Text style={[styles.manualTitle, { color: textPrimary }]}>
        {t(`activityTypes.${activityType}`, activityType)}
      </Text>
    </View>
  );
}
