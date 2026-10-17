/**
 * The engine's family enum and the family names the app keys its tables by,
 * one to one. The feed's chips filter by it and the map's counts arrive in it.
 */

import { EngineSportFamily } from 'veloqrs';

import type { SportFamily } from './sportCategories';

const TO_ENGINE: Record<SportFamily, EngineSportFamily> = {
  Ride: EngineSportFamily.Ride,
  Winter: EngineSportFamily.Winter,
  Run: EngineSportFamily.Run,
  Water: EngineSportFamily.Water,
  Foot: EngineSportFamily.Foot,
  Strength: EngineSportFamily.Strength,
  Other: EngineSportFamily.Other,
};

const FROM_ENGINE = new Map(
  (Object.entries(TO_ENGINE) as [SportFamily, EngineSportFamily][]).map(([name, value]) => [
    value,
    name,
  ])
);

/** The engine's value for a family. */
export function toEngineSportFamily(family: SportFamily): EngineSportFamily {
  return TO_ENGINE[family];
}

/** The family the engine named; a value this build does not know is Other. */
export function fromEngineSportFamily(family: EngineSportFamily): SportFamily {
  return FROM_ENGINE.get(family) ?? 'Other';
}
