import { View, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { styles } from '../RecordingScreen.styles';

export function GpsWarningBanner({
  gpsWarning,
  setGpsWarning,
}: {
  gpsWarning: string | null;
  setGpsWarning: (warning: string | null) => void;
}) {
  if (!gpsWarning) return null;
  return (
    <View style={styles.gpsWarningBanner}>
      <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#F59E0B" />
      <Text style={styles.gpsWarningText}>{gpsWarning}</Text>
      <TouchableOpacity
        onPress={() => setGpsWarning(null)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <MaterialCommunityIcons name="close" size={16} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
    </View>
  );
}
