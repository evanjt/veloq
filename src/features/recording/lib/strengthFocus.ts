import { FfiWeightUnit, type FfiFocusSet, type FfiLiveStrengthSession } from 'veloqrs';

/** Looks a key up with values filled in, falling back to the text given when the key has none. */
export type FocusTranslate = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>
) => string;

export interface FocusNames {
  current: string;
  previous: string | null;
  next: string | null;
}

/**
 * The names of the exercise in hand and its neighbours. The focus read carries
 * catalogue ids and the session carries the resolved names, so the names are
 * read off the session at the exercise the read points at.
 */
export function focusNames(
  session: Pick<FfiLiveStrengthSession, 'currentExercise' | 'exercises'>
): FocusNames {
  const at = session.currentExercise;
  if (at == null) return { current: '', previous: null, next: null };
  return {
    current: session.exercises[at]?.displayName ?? '',
    previous: session.exercises[at - 1]?.displayName ?? null,
    next: session.exercises[at + 1]?.displayName ?? null,
  };
}

/** The weight as the athlete reads it, with its unit. */
function focusWeightText(set: FfiFocusSet, translate: FocusTranslate): string | null {
  if (set.displayWeight == null) return null;
  return set.weightUnit === FfiWeightUnit.Pound
    ? translate('strength.recorder.weightLb', '{{value}} lb', { value: set.displayWeight })
    : translate('strength.recorder.weightKg', '{{value}} kg', { value: set.displayWeight });
}

/** "Set 2 of 3 · 8 × 40 kg": the place in the exercise, then what is to be done. */
export function focusSetText(set: FfiFocusSet, translate: FocusTranslate): string {
  const place = translate('strength.focus.setOf', 'Set {{n}} of {{total}}', {
    n: set.setNumber,
    total: set.setCount,
  });
  const weight = focusWeightText(set, translate);
  const work =
    set.reps != null && weight != null
      ? translate('strength.focus.repsAt', '{{reps}} × {{weight}}', { reps: set.reps, weight })
      : set.reps != null
        ? translate('strength.repsCount', '{{count}} reps', { count: set.reps })
        : weight;
  return work == null ? place : `${place} · ${work}`;
}
