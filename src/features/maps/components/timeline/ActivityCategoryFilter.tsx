import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography, spacing, layout } from '@/theme';
import {
  ACTIVITY_CATEGORIES,
  getActivityCategory,
  groupTypesByCategory,
} from '../ActivityTypeFilter';

interface ActivityCategoryFilterProps {
  selectedTypes: Set<string>;
  availableTypes: string[];
  onSelectionChange: (types: Set<string>) => void;
  isDark?: boolean;
}

export function ActivityCategoryFilter({
  selectedTypes,
  availableTypes,
  onSelectionChange,
  isDark = false,
}: ActivityCategoryFilterProps) {
  const { t } = useTranslation();

  // Group available types into categories
  const availableCategories = useMemo(() => {
    const grouped = groupTypesByCategory(availableTypes);
    // Return categories in a consistent order, only those that have types
    const categoryOrder = ['Ride', 'Run', 'Swim', 'Walk', 'Hike', 'Other'];
    return categoryOrder.filter((cat) => grouped.has(cat));
  }, [availableTypes]);

  // Check if a category is fully selected (all its types are selected)
  const isCategorySelected = useCallback(
    (category: string) => {
      const categoryTypes = availableTypes.filter((t) => getActivityCategory(t) === category);
      return categoryTypes.length > 0 && categoryTypes.every((t) => selectedTypes.has(t));
    },
    [selectedTypes, availableTypes]
  );

  // Toggle all types in a category
  const toggleCategory = useCallback(
    (category: string) => {
      const categoryTypes = availableTypes.filter((t) => getActivityCategory(t) === category);
      const newSelection = new Set(selectedTypes);
      const allSelected = categoryTypes.every((t) => selectedTypes.has(t));

      if (allSelected) {
        // Deselect all types in this category
        categoryTypes.forEach((t) => newSelection.delete(t));
      } else {
        // Select all types in this category
        categoryTypes.forEach((t) => newSelection.add(t));
      }
      onSelectionChange(newSelection);
    },
    [selectedTypes, onSelectionChange, availableTypes]
  );

  const toggleAllTypes = useCallback(() => {
    if (selectedTypes.size === availableTypes.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(availableTypes));
    }
  }, [availableTypes, selectedTypes, onSelectionChange]);

  if (availableCategories.length === 0) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterScrollContent}
      style={styles.filterScroll}
    >
      {/* All/Clear toggle */}
      <TouchableOpacity
        testID="map-filter-clear"
        style={[styles.controlChip, isDark && styles.controlChipDark]}
        onPress={toggleAllTypes}
      >
        <Text style={[styles.controlText, isDark && styles.controlTextDark]}>
          {selectedTypes.size === availableTypes.length ? t('maps.clear') : t('maps.allClear')}
        </Text>
      </TouchableOpacity>

      {/* Category chips */}
      {availableCategories.map((category) => {
        const config = ACTIVITY_CATEGORIES[category];
        const isSelected = isCategorySelected(category);

        return (
          <TouchableOpacity
            key={category}
            testID={`map-filter-${category.toLowerCase()}`}
            style={[
              styles.filterChip,
              isSelected && { backgroundColor: config.color },
              !isSelected && styles.filterChipUnselected,
              !isSelected && isDark && styles.filterChipUnselectedDark,
            ]}
            onPress={() => toggleCategory(category)}
          >
            <MaterialCommunityIcons
              name={config.icon}
              size={14}
              color={isSelected ? colors.surface : config.color}
            />
            <Text
              style={[
                styles.filterChipText,
                isSelected && styles.filterChipTextSelected,
                !isSelected && { color: config.color },
              ]}
            >
              {t(`maps.activityTypes.${config.labelKey}`)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  filterScroll: {
    marginBottom: spacing.sm,
  },
  filterScrollContent: {
    paddingHorizontal: spacing.xs,
    gap: 6,
    flexDirection: 'row',
  },
  controlChip: {
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
    borderRadius: layout.cardMargin,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  controlText: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.cardMargin,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipUnselected: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  filterChipText: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
  },
  filterChipTextSelected: {
    color: colors.surface,
  },
  // Dark mode
  controlChipDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
  controlTextDark: {
    color: darkColors.textMuted,
  },
  filterChipUnselectedDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
});
