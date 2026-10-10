import type { Athlete } from '@/types';

/**
 * The athlete's weight in kilograms from the stored intervals.icu profile, or
 * undefined when it carries none.
 *
 * The profile body sends the weight as `icu_weight` and leaves `weight` null,
 * so `icu_weight` is read first. Neither key is typed on `Athlete`, since the
 * body is stored raw and only the fields a screen reads are modelled.
 */
export function athleteWeightKg(profile: Athlete | null): number | undefined {
  const body = profile as Record<string, unknown> | null;
  for (const key of ['icu_weight', 'weight']) {
    const value = body?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}
