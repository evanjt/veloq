import { colors, activityTypeColors, sportFamilyColours } from '@/theme';
import type { ActivityType } from '@/types';
import type { MaterialIconName } from '@/shared/activity/activityUtils';
import {
  SPORT_FAMILY_MEMBERS,
  SPORT_SHADES,
  type SportFamily,
} from '@/shared/native/sportTaxonomy.generated';

export type { SportFamily };

/** The families in the order a stack of them is drawn, as the engine declares them. */
export const SPORT_FAMILY_ORDER = Object.keys(SPORT_FAMILY_MEMBERS) as SportFamily[];

/** Each family's label, as a translation key. */
export const SPORT_FAMILY_LABELS = {
  Ride: 'sportFamilies.ride',
  Winter: 'sportFamilies.winter',
  Run: 'sportFamilies.run',
  Water: 'sportFamilies.water',
  Foot: 'sportFamilies.foot',
  Strength: 'sportFamilies.strength',
  Other: 'sportFamilies.other',
} as const satisfies Record<SportFamily, string>;

const OTHER_COLOR: string = activityTypeColors.Other || colors.swim;
const WINTER_COLOR: string = activityTypeColors.AlpineSki || colors.swim;

/** How a family draws, until the family colour tokens replace these hues. */
const FAMILY_LOOK: Record<SportFamily, { color: string; icon: MaterialIconName }> = {
  Ride: { color: colors.ride, icon: 'bike' },
  Winter: { color: WINTER_COLOR, icon: 'ski' },
  Run: { color: colors.run, icon: 'run' },
  Water: { color: colors.swim, icon: 'swim' },
  Foot: { color: colors.walk, icon: 'walk' },
  Strength: { color: colors.workout, icon: 'dumbbell' },
  Other: { color: OTHER_COLOR, icon: 'heart-pulse' },
};

export interface SportFamilyConfig {
  color: string;
  icon: MaterialIconName;
  /** The family's label, as a translation key. */
  label: (typeof SPORT_FAMILY_LABELS)[SportFamily];
  /** The API types the engine files under this family. */
  types: string[];
}

/** Every family, keyed by its engine name, in stack order. */
export const ACTIVITY_CATEGORIES: Record<SportFamily, SportFamilyConfig> = Object.fromEntries(
  SPORT_FAMILY_ORDER.map((family) => [
    family,
    {
      ...FAMILY_LOOK[family],
      label: SPORT_FAMILY_LABELS[family],
      types: [...SPORT_FAMILY_MEMBERS[family]],
    },
  ])
) as Record<SportFamily, SportFamilyConfig>;

const FAMILY_OF: ReadonlyMap<string, SportFamily> = new Map(
  SPORT_FAMILY_ORDER.flatMap((family) =>
    SPORT_FAMILY_MEMBERS[family].map((type) => [type, family] as const)
  )
);

/** Whether a string names a family. */
export function isSportFamily(value: string): value is SportFamily {
  return Object.prototype.hasOwnProperty.call(SPORT_FAMILY_MEMBERS, value);
}

/** A family's label as a translation key; a name that is no family reads as Other. */
export function sportFamilyLabel(family: string): (typeof SPORT_FAMILY_LABELS)[SportFamily] {
  return SPORT_FAMILY_LABELS[isSportFamily(family) ? family : 'Other'];
}

/** The family an activity type is drawn in; a type no family lists is Other. */
export function getActivityCategory(type: string): SportFamily {
  return FAMILY_OF.get(type) ?? 'Other';
}

/** Fill and label ink of a selected period or distance chip. */
export const FILTER_CHIP = { fill: colors.actionPrimary, ink: colors.textOnFill } as const;

const SHADE_OF: ReadonlyMap<string, number> = new Map(
  Object.entries(SPORT_SHADES).flatMap(([shade, types]) =>
    types.map((type) => [type, Number(shade) - 1] as const)
  )
);

/**
 * The identity colour of a family, or of a sport within its family: a family
 * takes its own colour, a sport its fixed shade of its family's colour. It is a
 * mark, never a ground under a label.
 */
export function sportMarkColour(familyOrType: string, isDark: boolean): string {
  const steps = sportFamilyColours[isDark ? 'dark' : 'light'];
  if (isSportFamily(familyOrType)) return steps[familyOrType][0];
  const shades = steps[getActivityCategory(familyOrType)];
  // Other has no shades of its own, so a sport filed under it takes the family colour.
  return shades[SHADE_OF.get(familyOrType) ?? 0] ?? shades[0];
}

/** The family config of any activity type. */
export function getActivityTypeConfig(type: ActivityType | string): SportFamilyConfig {
  return ACTIVITY_CATEGORIES[getActivityCategory(type)];
}

/** Activity types grouped by family, each family in the order its types arrive. */
export function groupTypesByCategory(types: string[]): Map<SportFamily, string[]> {
  const groups = new Map<SportFamily, string[]>();

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
