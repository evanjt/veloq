/**
 * Sport-type filter pills for cross-sport routes and sections. Localised
 * labels, optional per-sport counts, sport-tinted selected state.
 */

import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { getActivityColor, getActivityIcon } from '@/features/activity/lib/activityUtils';
import { colors, colorWithOpacity, darkColors, spacing, typography } from '@/theme';
import { toActivityType } from '../types';

export interface SportTypeOption {
  type: string;
  count?: number;
}

interface SportTypeSelectorProps {
  options: SportTypeOption[];
  selectedType: string | undefined;
  onSelect: (type: string) => void;
  isDark: boolean;
}

export function SportTypeSelector({
  options,
  selectedType,
  onSelect,
  isDark,
}: SportTypeSelectorProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      {options.map(({ type, count }) => {
        const isSelected = type === selectedType;
        const sportColor = getActivityColor(toActivityType(type));
        const idleColor = isDark ? darkColors.textSecondary : colors.textSecondary;
        return (
          <TouchableOpacity
            key={type}
            style={[
              styles.pill,
              isDark && styles.pillDark,
              isSelected && {
                backgroundColor: colorWithOpacity(sportColor, 0.13),
                borderColor: sportColor,
              },
            ]}
            onPress={() => onSelect(type)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={getActivityIcon(toActivityType(type))}
              size={14}
              color={isSelected ? sportColor : idleColor}
            />
            <Text style={[styles.pillText, { color: isSelected ? sportColor : idleColor }]}>
              {t(`activityTypes.${type}`, type)}
              {count != null ? ` ${count}` : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  pillDark: {
    borderColor: darkColors.border,
  },
  pillText: {
    fontSize: typography.captionBold.fontSize,
    fontWeight: '600',
  },
});
