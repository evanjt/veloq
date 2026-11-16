/**
 * Scenario: a strength session runs with the phone locked. The notification is
 * the only surface, so it carries the engine's focus state.
 *
 * Expected behaviour: a rest counts down to the engine's `restEndsAt` and names the next set, a
 * set shows the set and no countdown, a finished session clears the notification.
 */
import { FocusPhase, WeightUnit, type FocusSet, type FocusState } from 'veloqrs';

import {
  buildStrengthNotificationPayload,
  type StrengthNotificationNames,
} from '../recordingNotification';
import { focusNames, focusSetText } from '../strengthFocus';

const translate = (_key: string, fallback: string, values: Record<string, string | number> = {}) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));

function set(overrides: Partial<FocusSet> = {}): FocusSet {
  return {
    exerciseCategory: 28,
    exerciseName: 1,
    setNumber: 2,
    setCount: 3,
    reps: 8,
    weightKg: 40,
    displayWeight: 40,
    weightUnit: WeightUnit.Kilogram,
    weightStep: 2.5,
    weightDownKg: 37.5,
    weightUpKg: 42.5,
    warmUp: false,
    ...overrides,
  } as FocusSet;
}

/** A set with no reps and no weight, as the engine answers an unplanned one. */
function unloaded(): FocusSet {
  const { reps: _reps, weightKg: _kg, displayWeight: _shown, ...rest } = set();
  return rest;
}

const names: StrengthNotificationNames = {
  current: 'Squat',
  previous: null,
  next: 'Row',
};

/** The state with an optional field absent, as the engine answers it. */
function without(state: FocusState, key: 'previous' | 'current'): FocusState {
  const { [key]: _omitted, ...rest } = state;
  return rest as FocusState;
}

function state(overrides: Partial<FocusState>): FocusState {
  return { phase: FocusPhase.Set, current: set(), ...overrides } as FocusState;
}

describe('buildStrengthNotificationPayload', () => {
  it('counts a timed rest down to the end the engine gives and names the next set', () => {
    const payload = buildStrengthNotificationPayload(
      state({ phase: FocusPhase.Rest, restStartedAt: 1_000, restSecs: 90, restEndsAt: 1_090 }),
      names,
      { translate, session: 7, nowMs: 1_010_000 }
    );
    expect(payload).toMatchObject({
      running: true,
      countdown: true,
      chronometerBase: 1_090_000,
      vibrateAt: 1_090_000,
      actions: [],
      session: 7,
    });
    expect(payload?.body).toBe('Next: Squat · Set 2 of 3 · 8 × 40 kg');
  });

  it('counts an untimed rest up from its start and does not vibrate', () => {
    const payload = buildStrengthNotificationPayload(
      state({ phase: FocusPhase.Rest, restStartedAt: 1_000 }),
      names,
      { translate, session: 7, nowMs: 1_010_000 }
    );
    expect(payload).toMatchObject({
      running: true,
      countdown: false,
      chronometerBase: 1_000_000,
      vibrateAt: null,
    });
  });

  it('shows a set with no countdown', () => {
    const payload = buildStrengthNotificationPayload(state({}), names, {
      translate,
      session: 7,
      nowMs: 1_010_000,
    });
    expect(payload).toMatchObject({
      title: 'Squat',
      body: 'Set 2 of 3 · 8 × 40 kg',
      running: false,
      countdown: false,
      vibrateAt: null,
    });
  });

  it('clears when the session is finished or has no current set', () => {
    const options = { translate, session: 7, nowMs: 0 };
    expect(
      buildStrengthNotificationPayload(
        without(state({ phase: FocusPhase.Finished }), 'current'),
        names,
        options
      )
    ).toBeNull();
    expect(buildStrengthNotificationPayload(null, names, options)).toBeNull();
  });
});

describe('focusSetText', () => {
  it('leaves out an unset weight and unset reps', () => {
    expect(focusSetText(unloaded(), translate)).toBe('Set 2 of 3');
  });
});

describe('focusNames', () => {
  it('reads the neighbours around the current exercise from the session', () => {
    const session = {
      currentExercise: 1,
      exercises: [{ displayName: 'Squat' }, { displayName: 'Row' }, { displayName: 'Press' }],
    };
    expect(focusNames(session as never)).toEqual({
      current: 'Row',
      previous: 'Squat',
      next: 'Press',
    });
  });

  it('gives no names without a current exercise', () => {
    expect(focusNames({ currentExercise: undefined, exercises: [] } as never)).toEqual({
      current: '',
      previous: null,
      next: null,
    });
  });
});
