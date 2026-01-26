import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, activityTypeColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import type { ActivityType } from '@/types';
import type { MaterialIconName } from '@/lib/utils/activityUtils';

// Activity type label keys for translation
type ActivityLabelKey =
  | 'ride'
  | 'run'
  | 'swim'
  | 'walk'
  | 'hike'
  | 'snow'
  | 'water'
  | 'gym'
  | 'racket'
  | 'other';

// Main activity categories (matching theme colors)
// Note: Labels are translation keys (maps.activityTypes.{key})
export const ACTIVITY_CATEGORIES: Record<
  string,
  {
    color: string;
    icon: MaterialIconName;
    labelKey: ActivityLabelKey; // Translation key suffix (e.g., 'ride' -> maps.activityTypes.ride)
    types: string[]; // API types that belong to this category
  }
> = {
  Ride: {
    color: colors.ride,
    icon: 'bike',
    labelKey: 'ride',
    types: [
      'Ride',
      'VirtualRide',
      'EBikeRide',
      'MountainBikeRide',
      'GravelRide',
      'Velomobile',
      'Handcycle',
    ],
  },
  Run: {
    color: colors.run,
    icon: 'run',
    labelKey: 'run',
    types: ['Run', 'TrailRun', 'VirtualRun', 'Treadmill'],
  },
  Swim: {
    color: colors.swim,
    icon: 'swim',
    labelKey: 'swim',
    types: ['Swim', 'OpenWaterSwim'],
  },
  Walk: {
    color: colors.walk,
    icon: 'walk',
    labelKey: 'walk',
    types: ['Walk'],
  },
  Hike: {
    color: colors.hike,
    icon: 'hiking',
    labelKey: 'hike',
    types: ['Hike', 'Snowshoe'],
  },
  Snow: {
    color: activityTypeColors.AlpineSki,
    icon: 'ski',
    labelKey: 'snow',
    types: ['AlpineSki', 'NordicSki', 'BackcountrySki', 'Snowboard', 'RollerSki'],
  },
  Water: {
    color: activityTypeColors.Rowing || '#06B6D4',
    icon: 'rowing',
    labelKey: 'water',
    types: [
      'Rowing',
      'VirtualRow',
      'Kayaking',
      'Canoeing',
      'Surfing',
      'Kitesurf',
      'Windsurf',
      'StandUpPaddling',
      'Sail',
    ],
  },
  Gym: {
    color: colors.workout,
    icon: 'dumbbell',
    labelKey: 'gym',
    types: [
      'Workout',
      'WeightTraining',
      'Yoga',
      'Pilates',
      'Crossfit',
      'Elliptical',
      'StairStepper',
      'HighIntensityIntervalTraining',
      'IceSkate',
      'InlineSkate',
      'Skateboard',
    ],
  },
  Racket: {
    color: activityTypeColors.Tennis || '#22C55E',
    icon: 'tennis',
    labelKey: 'racket',
    types: ['Tennis', 'Badminton', 'Pickleball', 'Racquetball', 'Squash', 'TableTennis'],
  },
  Other: {
    color: colors.textSecondary,
    icon: 'heart-pulse',
    labelKey: 'other',
    types: ['Soccer', 'Golf', 'RockClimbing', 'Wheelchair'], // Named types that don't fit elsewhere + catch-all
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
  const { t } = useTranslation();

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
            {selectedTypes.size === availableTypes.length ? t('maps.clear') : t('maps.allClear')}
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
              <MaterialCommunityIcons
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
                {t(`maps.activityTypes.${config.labelKey}`)}
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
