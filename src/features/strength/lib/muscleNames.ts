import type { ParseKeys } from 'i18next';

import type { MuscleSlug } from './exerciseMuscleMap';

export type NameTranslator = (key: ParseKeys) => string;

/** Each muscle slug and the `strength.muscles.*` key its name is read from. */
export const MUSCLE_NAME_KEYS: Record<MuscleSlug, ParseKeys> = {
  abs: 'strength.muscles.abs',
  adductors: 'strength.muscles.adductors',
  biceps: 'strength.muscles.biceps',
  calves: 'strength.muscles.calves',
  chest: 'strength.muscles.chest',
  deltoids: 'strength.muscles.deltoids',
  forearm: 'strength.muscles.forearm',
  gluteal: 'strength.muscles.gluteal',
  hamstring: 'strength.muscles.hamstring',
  'lower-back': 'strength.muscles.lowerBack',
  obliques: 'strength.muscles.obliques',
  quadriceps: 'strength.muscles.quadriceps',
  trapezius: 'strength.muscles.trapezius',
  triceps: 'strength.muscles.triceps',
  'upper-back': 'strength.muscles.upperBack',
};

/** Each balance pair id the engine sends and the `strength.balancePairs.*` key its name is read from. */
export const BALANCE_PAIR_NAME_KEYS: Record<string, ParseKeys> = {
  quads_hamstrings: 'strength.balancePairs.quadsHamstrings',
  chest_back: 'strength.balancePairs.chestBack',
  biceps_triceps: 'strength.balancePairs.bicepsTriceps',
};

/** The engine's slugs are the same set, but they cross the FFI as strings. */
export function muscleName(slug: string, t: NameTranslator): string {
  const key = MUSCLE_NAME_KEYS[slug as MuscleSlug];
  return key ? t(key) : slug;
}

export function balancePairName(id: string, t: NameTranslator): string {
  const key = BALANCE_PAIR_NAME_KEYS[id];
  return key ? t(key) : id;
}
