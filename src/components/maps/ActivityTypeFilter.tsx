import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import type { ActivityType } from '@/types';

// Main activity categories (matching theme colors)
export const ACTIVITY_CATEGORIES: Record<string, {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  types: string[]; // API types that belong to this category
}> = {
  Ride: {
    color: colors.ride,
    icon: 'bicycle',
    label: 'Ride',
    types: ['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile'],
  },
  Run: {
    color: colors.run,
    icon: 'walk',
    label: 'Run',
    types: ['Run', 'TrailRun', 'VirtualRun', 'Treadmill'],
  },
  Swim: {
    color: colors.swim,
    icon: 'water',
    label: 'Swim',
    types: ['Swim', 'OpenWaterSwim'],
  },
  Walk: {
    color: colors.walk,
    icon: 'footsteps',
    label: 'Walk',
    types: ['Walk'],
  },
  Hike: {
    color: colors.hike,
    icon: 'trail-sign',
    label: 'Hike',
    types: ['Hike'],
  },
  Other: {
    color: colors.workout,
    icon: 'fitness',
    label: 'Other',
    types: [], // Catch-all for anything not in other categories
  },
};

// Map any activity type to its category
export function getActivityCategory(type: string): string {
  for (const [category, config] of Object.entries(ACTIVITY_CATEGORIES)) {
    if (config.types.includes(type)) {
      return category;
    }
  }
  return 'Other';
}

// Get config for any activity type (returns the category config)
export function getActivityTypeConfig(type: ActivityType | string) {
  const category = getActivityCategory(type);
  return ACTIVITY_CATEGORIES[category];
}

// Group activity types by category
export function groupTypesByCategory(types: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const type of types) {
    const category = getActivityCategory(type);
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)!.push(type);
  }

  return groups;
}

interface ActivityTypeFilterProps {
  /** Set of currently selected activity types */
  selectedTypes: Set<string>;
  /** Available activity types to show (from the data) */
  availableTypes: string[];
  /** Callback when selection changes */
  onSelectionChange: (types: Set<string>) => void;
}

export function ActivityTypeFilter({
  selectedTypes,
  availableTypes,
  onSelectionChange,
}: ActivityTypeFilterProps) {
  const toggleType = (type: string) => {
    const newSelection = new Set(selectedTypes);
    if (newSelection.has(type)) {
      newSelection.delete(type);
    } else {
      newSelection.add(type);
    }
    onSelectionChange(newSelection);
  };

  const selectAll = () => {
    onSelectionChange(new Set(availableTypes));
  };

  const deselectAll = () => {
    onSelectionChange(new Set());
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Select All / Deselect All buttons */}
        <TouchableOpacity
          style={styles.controlChip}
          onPress={selectedTypes.size === availableTypes.length ? deselectAll : selectAll}
        >
          <Text style={styles.controlText}>
            {selectedTypes.size === availableTypes.length ? 'Clear' : 'All'}
          </Text>
        </TouchableOpacity>

        {/* Activity type chips */}
        {availableTypes.map((type) => {
          const config = getActivityTypeConfig(type);
          const isSelected = selectedTypes.has(type);

          return (
            <TouchableOpacity
              key={type}
              style={[
                styles.chip,
                isSelected && { backgroundColor: config.color },
                !isSelected && styles.chipUnselected,
              ]}
              onPress={() => toggleType(type)}
            >
              <Ionicons
                name={config.icon}
                size={16}
                color={isSelected ? colors.surface : config.color}
              />
              <Text
                style={[
                  styles.chipText,
                  isSelected && styles.chipTextSelected,
                  !isSelected && { color: config.color },
                ]}
              >
                {config.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scrollContent: {
    paddingHorizontal: layout.cardMargin,
    gap: spacing.sm,
    flexDirection: 'row',
  },
  controlChip: {
    paddingHorizontal: layout.cardMargin,
    paddingVertical: 6,
    borderRadius: spacing.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  controlText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: layout.cardMargin,
    paddingVertical: 6,
    borderRadius: spacing.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipUnselected: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  chipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: colors.surface,
  },
});
