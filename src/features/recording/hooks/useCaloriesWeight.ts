import { useAthlete } from '@/shared/app/useAthlete';

/** The age the heart-rate calories regression assumes, since the profile carries none. */
export const CALORIES_ASSUMED_AGE = 35;

/** The weight the calories estimate assumes when the profile carries none. */
export const DEFAULT_WEIGHT_KG = 70;

/**
 * The weight and sex the live calories estimate uses: the profile's weight,
 * else the default, with `assumed` saying which so the field picker can tell
 * the athlete. The profile is the engine's, read through the athlete query.
 */
export function useCaloriesWeight(): {
  weightKg: number;
  assumed: boolean;
  sex: string | null | undefined;
} {
  const athlete = useAthlete().data;
  const profileWeight = athlete?.weightKg;
  const sex = athlete?.sex;
  return profileWeight === undefined
    ? { weightKg: DEFAULT_WEIGHT_KG, assumed: true, sex }
    : { weightKg: profileWeight, assumed: false, sex };
}
