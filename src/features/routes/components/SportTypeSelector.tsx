import { View, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { getActivityColor, getActivityIcon } from '@/features/activity/lib/activityUtils';
import { colors, darkColors } from '@/theme';
import { toActivityType } from '../types';
import { styles } from './RouteDetailScreen.styles';

interface SportTypeSelectorProps {
  availableSportTypes: string[];
  selectedSportType: string | undefined;
  onSelect: (type: string) => void;
  isDark: boolean;
}

export function SportTypeSelector({
  availableSportTypes,
  selectedSportType,
  onSelect,
  isDark,
}: SportTypeSelectorProps) {
  return (
    <View style={styles.sportTypeSelector}>
      {availableSportTypes.map((st) => {
        const isSelected = st === selectedSportType;
        const sportColor = getActivityColor(toActivityType(st));
        return (
          <TouchableOpacity
            key={st}
            style={[
              styles.sportTypePill,
              isDark && styles.sportTypePillDark,
              isSelected && { backgroundColor: sportColor },
            ]}
            onPress={() => onSelect(st)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={getActivityIcon(toActivityType(st))}
              size={16}
              color={
                isSelected
                  ? colors.textOnDark
                  : isDark
                    ? darkColors.textSecondary
                    : colors.textSecondary
              }
            />
            <Text
              style={[
                styles.sportTypePillText,
                isSelected
                  ? { color: colors.textOnDark }
                  : isDark
                    ? { color: darkColors.textSecondary }
                    : { color: colors.textSecondary },
              ]}
            >
              {st}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
