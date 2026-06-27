import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { styles } from '../RecordingScreen.styles';

export function KmSplitBanner({ splitBanner }: { splitBanner: string | null }) {
  if (!splitBanner) return null;
  return (
    <View style={styles.splitBanner}>
      <MaterialCommunityIcons name="flag-variant" size={16} color="#FFFFFF" />
      <Text style={styles.splitBannerText}>{splitBanner}</Text>
    </View>
  );
}
