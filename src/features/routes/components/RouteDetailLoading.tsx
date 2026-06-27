import { View, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { EdgeInsets } from 'react-native-safe-area-context';

import { colors, darkColors } from '@/theme';
import { styles } from './RouteDetailScreen.styles';

interface RouteDetailLoadingProps {
  isDark: boolean;
  insets: EdgeInsets;
  onBackPress: () => void;
}

export function RouteDetailLoading({ isDark, insets, onBackPress }: RouteDetailLoadingProps) {
  const { t } = useTranslation();
  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={onBackPress} activeOpacity={0.7}>
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={isDark ? colors.textOnDark : colors.textPrimary}
          />
        </TouchableOpacity>
      </View>
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="map-marker-question-outline"
          size={48}
          color={isDark ? darkColors.border : colors.divider}
        />
        <Text style={[styles.emptyText, isDark && styles.textLight]}>
          {t('routeDetail.routeNotFound')}
        </Text>
      </View>
    </View>
  );
}
