import { colors, sportFamilyColours } from '@/theme';
import type { MaterialIconName } from '@/shared/activity/activityUtils';
import {
  SPORT_FAMILY_MEMBERS,
  SPORT_SHADES,
  type SportFamily,
} from '@/shared/native/sportTaxonomy.generated';

export type { SportFamily };
export { SPORT_FAMILY_MEMBERS };

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

/** Each family's glyph. */
export const SPORT_FAMILY_ICONS: Record<SportFamily, MaterialIconName> = {
  Ride: 'bike',
  Winter: 'ski',
  Run: 'run',
  Water: 'swim',
  Foot: 'walk',
  Strength: 'dumbbell',
  Other: 'heart-pulse',
};

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
