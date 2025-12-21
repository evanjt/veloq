import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';
import type { ActivityType } from '@/types';

// Activity type configuration with colors and icons
export const ACTIVITY_TYPE_CONFIG: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  Run: { color: colors.run, icon: 'walk', label: 'Run' },
  TrailRun: { color: colors.run, icon: 'walk', label: 'Trail' },
  Ride: { color: colors.ride, icon: 'bicycle', label: 'Ride' },
  VirtualRide: { color: colors.ride, icon: 'bicycle', label: 'Virtual' },
  Walk: { color: colors.walk, icon: 'footsteps', label: 'Walk' },
  Hike: { color: colors.hike, icon: 'trail-sign', label: 'Hike' },
  Swim: { color: colors.swim, icon: 'water', label: 'Swim' },
  OpenWaterSwim: { color: colors.swim, icon: 'water', label: 'OW Swim' },
  Other: { color: colors.workout, icon: 'fitness', label: 'Other' },
};

// Get config for any activity type, falling back to "Other" for unknown types
export function getActivityTypeConfig(type: ActivityType | string) {
  return ACTIVITY_TYPE_CONFIG[type] || ACTIVITY_TYPE_CONFIG.Other;
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
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scrollContent: {
    paddingHorizontal: 12,
    gap: 8,
    flexDirection: 'row',
  },
  controlChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  controlText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipUnselected: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: colors.surface,
  },
});
