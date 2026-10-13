import { useAuthStore } from '@/shared/app/AuthStore';
import { athleteWeightKg } from '@/features/recording/lib/athleteWeight';

/** The age the heart-rate calories regression assumes, since the profile carries none. */
export const CALORIES_ASSUMED_AGE = 35;

/** The weight the calories estimate assumes when the profile carries none. */
export const DEFAULT_WEIGHT_KG = 70;

/**
 * The weight the live calories estimate uses: the profile's, else the default,
 * with `assumed` saying which so the field picker can tell the athlete.
 */
export function useCaloriesWeight(): { weightKg: number; assumed: boolean } {
  const profileWeight = useAuthStore((s) => athleteWeightKg(s.athlete));
  return profileWeight === undefined
    ? { weightKg: DEFAULT_WEIGHT_KG, assumed: true }
    : { weightKg: profileWeight, assumed: false };
}
