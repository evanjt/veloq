import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';
import type { SectionsSortOption } from './SectionsList';

type HiddenFilters = {
  custom: boolean;
  auto: boolean;
  disabled: boolean;
  unaccepted: boolean;
};

interface SectionsListFiltersBarProps {
  regularSectionsCount: number;
  sortOption: SectionsSortOption;
  onSortChange: (next: SectionsSortOption) => void;
  sortChips: { key: SectionsSortOption; label: string; icon: string }[];
  customCount: number;
  hiddenFilters: HiddenFilters;
  onFilterPress: (filterType: keyof HiddenFilters) => void;
  trueDisabledCount: number;
  unacceptedAutoCount: number;
  acceptedAutoCount: number;
}

export function SectionsListFiltersBar({
  regularSectionsCount,
  sortOption,
  onSortChange,
  sortChips,
  customCount,
  hiddenFilters,
  onFilterPress,
  trueDisabledCount,
  unacceptedAutoCount,
  acceptedAutoCount,
}: SectionsListFiltersBarProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  return (
    <View style={styles.sortChipRow}>
      {regularSectionsCount > 1 &&
        sortChips.map((chip) => {
          const isActive = sortOption === chip.key;
          return (
            <TouchableOpacity
              key={chip.key}
              style={[
                styles.sortChip,
                isDark && styles.sortChipDark,
                isActive && styles.sortChipActive,
              ]}
              onPress={() => onSortChange(chip.key)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={chip.icon as any}
                size={13}
                color={
                  isActive
                    ? colors.primary
                    : isDark
                      ? darkColors.textSecondary
                      : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.sortChipLabel,
                  isDark && styles.textMuted,
                  isActive && styles.sortChipLabelActive,
                ]}
              >
                {chip.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      {customCount > 0 && (
        <TouchableOpacity
          style={[
            styles.sortChip,
            isDark && styles.sortChipDark,
            !hiddenFilters.custom && styles.sortChipActive,
          ]}
          onPress={() => onFilterPress('custom')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="account"
            size={13}
            color={
              !hiddenFilters.custom
                ? colors.primary
                : isDark
                  ? darkColors.textSecondary
                  : colors.textSecondary
            }
          />
          <Text
            style={[
              styles.sortChipLabel,
              isDark && styles.textMuted,
              !hiddenFilters.custom && styles.sortChipLabelActive,
            ]}
          >
            {customCount} {t('routes.custom')}
          </Text>
        </TouchableOpacity>
      )}
      {trueDisabledCount > 0 && (
        <TouchableOpacity
          style={[
            styles.sortChip,
            isDark && styles.sortChipDark,
            !hiddenFilters.disabled && styles.sortChipActive,
          ]}
          onPress={() => onFilterPress('disabled')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name={hiddenFilters.disabled ? 'eye-off' : 'eye'}
            size={13}
            color={
              !hiddenFilters.disabled
                ? colors.primary
                : isDark
                  ? darkColors.textSecondary
                  : colors.textSecondary
            }
          />
          <Text
            style={[
              styles.sortChipLabel,
              isDark && styles.textMuted,
              !hiddenFilters.disabled && styles.sortChipLabelActive,
            ]}
          >
            {trueDisabledCount} {t('sections.removed')}
          </Text>
        </TouchableOpacity>
      )}
      {unacceptedAutoCount > 0 && acceptedAutoCount > 0 && (
        <TouchableOpacity
          style={[
            styles.sortChip,
            isDark && styles.sortChipDark,
            hiddenFilters.unaccepted && styles.sortChipActive,
          ]}
          onPress={() => onFilterPress('unaccepted')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="pin"
            size={13}
            color={
              hiddenFilters.unaccepted
                ? colors.primary
                : isDark
                  ? darkColors.textSecondary
                  : colors.textSecondary
            }
          />
          <Text
            style={[
              styles.sortChipLabel,
              isDark && styles.textMuted,
              hiddenFilters.unaccepted && styles.sortChipLabelActive,
            ]}
          >
            {t('sections.pinnedOnly')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sortChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipDark: {
    borderColor: darkColors.border,
  },
  sortChipActive: {
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary,
  },
  sortChipLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  sortChipLabelActive: {
    color: colors.primary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
});
