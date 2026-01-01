import type { ActivityType } from '@/types';
import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { activityTypeColors } from '@/theme';

// Type for valid MaterialCommunityIcons names
export type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

// Icon names used for activities - these are all valid MaterialCommunityIcons
const ACTIVITY_ICONS = {
  Ride: 'bike',
  Run: 'run',
  Swim: 'swim',
  OpenWaterSwim: 'swim',
  Walk: 'walk',
  Hike: 'hiking',
  VirtualRide: 'bike',
  VirtualRun: 'run',
  Workout: 'dumbbell',
  WeightTraining: 'weight-lifter',
  Yoga: 'yoga',
  Snowboard: 'snowboard',
  AlpineSki: 'ski',
  NordicSki: 'ski-cross-country',
  BackcountrySki: 'ski',
  Rowing: 'rowing',
  Kayaking: 'kayaking',
  Canoeing: 'kayaking',
  Other: 'heart-pulse',
} as const satisfies Record<string, MaterialIconName>;

export function getActivityIcon(type: ActivityType): MaterialIconName {
  return ACTIVITY_ICONS[type as keyof typeof ACTIVITY_ICONS] ?? 'heart-pulse';
}

/**
 * Get the color for an activity type.
 * Colors are defined in the theme to ensure consistency.
 *
 * Cycling activities: Blue (#3B82F6)
 * Running activities: Emerald (#10B981)
 * Swimming activities: Cyan (#06B6D4)
 */
export function getActivityColor(type: ActivityType): string {
  return activityTypeColors[type] || activityTypeColors.Other;
}

export function isRunningActivity(type: ActivityType): boolean {
  return ['Run', 'VirtualRun', 'Walk', 'Hike'].includes(type);
}

export function isCyclingActivity(type: ActivityType): boolean {
  return ['Ride', 'VirtualRide'].includes(type);
}

/**
 * Sort items by date ID in chronological order.
 * The id is expected to be a date string in YYYY-MM-DD format.
 * This is a common operation in fitness charts.
 *
 * @param items - Array of items with an id property containing a date string
 * @returns New sorted array (does not mutate original)
 */
export function sortByDateId<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}
