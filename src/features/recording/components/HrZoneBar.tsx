import { View } from 'react-native';

import { styles } from '../RecordingScreen.styles';

export function HrZoneBar({ hrZoneColor }: { hrZoneColor: string | null }) {
  if (!hrZoneColor) return null;
  return <View testID="hr-zone-bar" style={[styles.hrZoneBar, { backgroundColor: hrZoneColor }]} />;
}
