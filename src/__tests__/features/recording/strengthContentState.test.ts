/**
 * Scenario: the lock-screen card for a strength session is drawn from the engine's focus read.
 * Expected behaviour: a rest ends at the engine's end in ms and names the set that follows, a set
 * has no rest end, and a finished session has no card.
 */
import { FfiFocusPhase, FfiWeightUnit, type FfiFocusState } from 'veloqrs';

import { buildStrengthContentState } from '@/features/recording/lib/liveActivity/strengthContentState';

const translate = (_key: string, fallback: string, values: Record<string, string | number> = {}) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));

const names = { current: 'Row', previous: null, next: null };

function focus(overrides: Partial<FfiFocusState>): FfiFocusState {
  return {
    phase: FfiFocusPhase.Set,
    current: {
      exerciseCategory: 23,
      exerciseName: 2,
      setNumber: 1,
      setCount: 3,
      reps: 8,
      weightKg: 40,
      displayWeight: 40,
      weightUnit: FfiWeightUnit.Kilogram,
      weightStep: 2.5,
      weightDownKg: 37.5,
      weightUpKg: 42.5,
      warmUp: false,
    },
    ...overrides,
  } as FfiFocusState;
}

describe('buildStrengthContentState', () => {
  it('reads a rest as ending at the engine end, naming the set that follows', () => {
    const state = buildStrengthContentState(
      focus({ phase: FfiFocusPhase.Rest, restStartedAt: 1_000, restSecs: 90, restEndsAt: 1_090 }),
      names,
      1_000_000,
      translate
    );
    expect(state).toMatchObject({
      phase: 'rest',
      exercise: 'Row',
      nextSet: 'Row · Set 1 of 3 · 8 × 40 kg',
      restEndsAt: 1_090_000,
    });
  });

  it('reads a rest with no length as having no end', () => {
    const state = buildStrengthContentState(
      focus({ phase: FfiFocusPhase.Rest, restStartedAt: 1_000 }),
      names,
      2_000_000,
      translate
    );
    expect(state).toMatchObject({ phase: 'rest', restEndsAt: null });
  });

  it('reads a set with no rest end', () => {
    expect(buildStrengthContentState(focus({}), names, 5, translate)).toMatchObject({
      phase: 'set',
      exercise: 'Row',
      nextSet: null,
      restEndsAt: null,
    });
  });

  it('is null once finished, with no set, or with no read', () => {
    expect(
      buildStrengthContentState(focus({ phase: FfiFocusPhase.Finished }), names, 5, translate)
    ).toBeNull();
    expect(buildStrengthContentState(null, names, 5, translate)).toBeNull();
    const { current: _current, ...bare } = focus({});
    expect(buildStrengthContentState(bare as FfiFocusState, names, 5, translate)).toBeNull();
  });
});
