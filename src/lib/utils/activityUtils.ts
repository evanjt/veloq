/**
 * @fileoverview Activity type utilities and helpers
 *
 * Provides functions for activity type classification, icons, and colors.
 * Used throughout the app for consistent activity representation.
 */

import type { ActivityType } from '@/types';
import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { activityTypeColors } from '@/theme';

/** Type for valid MaterialCommunityIcons names */
export type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * Icon names mapping for activity types.
 *
 * Maps each activity type to a corresponding MaterialCommunityIcons icon name.
 * Activities with no specific mapping fall back to 'heart-pulse'.
 */
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

/**
 * Get icon name for an activity type.
 *
 * Returns the MaterialCommunityIcons icon name for displaying activity types.
 * Falls back to 'heart-pulse' for unknown activity types.
 *
 * @param type - Activity type
 * @returns MaterialCommunityIcons icon name
 *
 * @example
 * ```ts
 * getActivityIcon('Ride');  // 'bike'
 * getActivityIcon('Run');   // 'run'
 * getActivityIcon('Other'); // 'heart-pulse'
 * ```
 */
export function getActivityIcon(type: ActivityType): MaterialIconName {
  return ACTIVITY_ICONS[type as keyof typeof ACTIVITY_ICONS] ?? 'heart-pulse';
}

/**
 * Get color for an activity type.
 *
 * Returns the theme color associated with each activity type.
 * Colors are semantic (blue for cycling, emerald for running, cyan for swimming).
 *
 * @param type - Activity type
 * @returns Hex color string (e.g., "#3B82F6")
 *
 * @example
 * ```ts
 * getActivityColor('Ride');  // "#3B82F6" (blue)
 * getActivityColor('Run');   // "#10B981" (emerald)
 * ```
 */
export function getActivityColor(type: ActivityType): string {
  return activityTypeColors[type] || activityTypeColors.Other;
}

/**
 * Check if activity type is a running activity.
 *
 * Includes running, walking, and hiking activities (both virtual and outdoor).
 *
 * @param type - Activity type to check
 * @returns True if activity is running-related
 */
export function isRunningActivity(type: ActivityType): boolean {
  return ['Run', 'VirtualRun', 'Walk', 'Hike'].includes(type);
}

/**
 * Check if activity type is a cycling activity.
 *
 * Includes both outdoor and virtual cycling activities.
 *
 * @param type - Activity type to check
 * @returns True if activity is cycling-related
 */
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
