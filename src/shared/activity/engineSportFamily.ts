/**
 * The engine's family enum and the family names the app keys its tables by,
 * one to one. The feed's chips filter by it and the map's counts arrive in it.
 */

import { FfiSportFamily } from 'veloqrs';

import type { SportFamily } from './sportCategories';

const TO_ENGINE: Record<SportFamily, FfiSportFamily> = {
  Ride: FfiSportFamily.Ride,
  Winter: FfiSportFamily.Winter,
  Run: FfiSportFamily.Run,
  Water: FfiSportFamily.Water,
  Foot: FfiSportFamily.Foot,
  Strength: FfiSportFamily.Strength,
  Other: FfiSportFamily.Other,
};

const FROM_ENGINE = new Map(
  (Object.entries(TO_ENGINE) as [SportFamily, FfiSportFamily][]).map(([name, value]) => [
    value,
    name,
  ])
);

/** The engine's value for a family. */
export function toEngineSportFamily(family: SportFamily): FfiSportFamily {
  return TO_ENGINE[family];
}

/** The family the engine named; a value this build does not know is Other. */
export function fromEngineSportFamily(family: FfiSportFamily): SportFamily {
  return FROM_ENGINE.get(family) ?? 'Other';
}
