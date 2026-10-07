import { colors, activityTypeColors } from '@/theme';
import type { ActivityType } from '@/types';
import type { MaterialIconName } from '@/shared/activity/activityUtils';
import { SPORT_DISPLAY_GROUPS } from '@/shared/native/sportTaxonomy.generated';

const FEED_GROUP_ORDER = ['Cycling', 'Running', 'Swimming', 'Other'] as const;
export type FeedGroup = (typeof FEED_GROUP_ORDER)[number];

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

const WATER_COLOR: string = activityTypeColors.Rowing || colors.swim;
const OTHER_COLOR: string = activityTypeColors.Other || colors.swim;
const SNOW_COLOR: string = activityTypeColors.AlpineSki || colors.swim;
const RACKET_COLOR: string = activityTypeColors.Tennis || colors.textSecondary;

// Main activity categories (matching theme colors)
// Note: Labels are translation keys (maps.activityTypes.{key})
export const ACTIVITY_CATEGORIES: Record<
  string,
  {
    color: string;
    // Fill and ink of the selected chip, measured against each other rather than against white.
    selectedFill: string;
    selectedInk: string;
    icon: MaterialIconName;
    labelKey: ActivityLabelKey; // Translation key suffix (e.g., 'ride' -> maps.activityTypes.ride)
    types: string[]; // API types that belong to this category
    coarseGroup: FeedGroup;
  }
> = {
  Ride: {
    coarseGroup: 'Cycling',
    color: colors.ride,
    selectedFill: colors.ride,
    selectedInk: colors.textPrimary,
    icon: 'bike',
    labelKey: 'ride',
    types: [...SPORT_DISPLAY_GROUPS.Ride],
  },
  Run: {
    coarseGroup: 'Running',
    color: colors.run,
    selectedFill: colors.run,
    selectedInk: colors.textPrimary,
    icon: 'run',
    labelKey: 'run',
    types: [...SPORT_DISPLAY_GROUPS.Run],
  },
  Swim: {
    coarseGroup: 'Swimming',
    color: colors.swim,
    selectedFill: colors.swim,
    selectedInk: colors.textPrimary,
    icon: 'swim',
    labelKey: 'swim',
    types: [...SPORT_DISPLAY_GROUPS.Swim],
  },
  Walk: {
    coarseGroup: 'Other',
    color: colors.walk,
    selectedFill: colors.walkChipFill,
    selectedInk: colors.textOnDark,
    icon: 'walk',
    labelKey: 'walk',
    types: [...SPORT_DISPLAY_GROUPS.Walk],
  },
  Hike: {
    coarseGroup: 'Other',
    color: colors.hike,
    selectedFill: colors.hike,
    selectedInk: colors.textPrimary,
    icon: 'hiking',
    labelKey: 'hike',
    types: [...SPORT_DISPLAY_GROUPS.Hike],
  },
  Snow: {
    coarseGroup: 'Other',
    color: SNOW_COLOR,
    selectedFill: SNOW_COLOR,
    selectedInk: colors.textPrimary,
    icon: 'ski',
    labelKey: 'snow',
    types: [...SPORT_DISPLAY_GROUPS.Snow],
  },
  Water: {
    coarseGroup: 'Other',
    color: WATER_COLOR,
    selectedFill: WATER_COLOR,
    selectedInk: colors.textPrimary,
    icon: 'rowing',
    labelKey: 'water',
    types: [...SPORT_DISPLAY_GROUPS.Water],
  },
  Gym: {
    coarseGroup: 'Other',
    color: colors.workout,
    selectedFill: colors.workoutChipFill,
    selectedInk: colors.textOnDark,
    icon: 'dumbbell',
    labelKey: 'gym',
    types: [...SPORT_DISPLAY_GROUPS.Gym],
  },
  Racket: {
    coarseGroup: 'Other',
    color: RACKET_COLOR,
    selectedFill: RACKET_COLOR,
    selectedInk: colors.textOnDark,
    icon: 'tennis',
    labelKey: 'racket',
    types: [...SPORT_DISPLAY_GROUPS.Racket],
  },
  Other: {
    coarseGroup: 'Other',
    color: OTHER_COLOR,
    selectedFill: OTHER_COLOR,
    selectedInk: colors.textOnDark,
    icon: 'heart-pulse',
    labelKey: 'other',
    types: [...SPORT_DISPLAY_GROUPS.Other],
  },
};

/** The coarse view keeps its stable order while sharing category membership. */
export const FEED_GROUPS: readonly FeedGroup[] = FEED_GROUP_ORDER.filter((group) =>
  Object.values(ACTIVITY_CATEGORIES).some((category) => category.coarseGroup === group)
);

/** Fill and label ink of a selected period or distance chip. */
export const FILTER_CHIP = { fill: colors.primary, ink: colors.textOnPrimary } as const;

/** A sport chip's fill and label ink: the measured pair when selected, the icon hue on the card otherwise. */
export function categoryChipColours(
  category: string,
  selected: boolean
): { fill: string | null; ink: string } {
  const config = ACTIVITY_CATEGORIES[category];
  if (!config) return { fill: null, ink: colors.textSecondary };
  return selected
    ? { fill: config.selectedFill, ink: config.selectedInk }
    : { fill: null, ink: config.color };
}

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
    let inCategory = groups.get(category);
    if (!inCategory) {
      inCategory = [];
      groups.set(category, inCategory);
    }
    inCategory.push(type);
  }

  return groups;
}
