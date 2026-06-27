import { View, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { EdgeInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { styles } from './RouteDetailScreen.styles';

interface RouteDetailHeroHeaderProps {
  onBackPress: () => void;
  insets: EdgeInsets;
}

export function RouteDetailHeroHeader({ onBackPress, insets }: RouteDetailHeroHeaderProps) {
  return (
    <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
      <TouchableOpacity style={styles.backButton} onPress={onBackPress} activeOpacity={0.7}>
        <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textOnDark} />
      </TouchableOpacity>
      <View style={{ flex: 1 }} />
    </View>
  );
}
