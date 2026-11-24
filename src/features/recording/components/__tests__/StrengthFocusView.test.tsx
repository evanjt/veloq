/**
 * Scenario: a lifter glances at the phone between sets.
 *
 * Expected behaviour: the view draws the engine's focus state. It names the exercise and set in
 * hand, the previous and next exercise from the neighbours the engine gives, and a rest shows the
 * remaining time. Finishing the set sends one call to the owner of the session.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FfiFocusPhase, FfiWeightUnit, type FfiFocusSet, type FfiFocusState } from 'veloqrs';

import { StrengthFocusView } from '../StrengthFocusView';

const current: FfiFocusSet = {
  exerciseCategory: 28,
  exerciseName: 1,
  setNumber: 2,
  setCount: 3,
  reps: 8,
  weightKg: 40,
  displayWeight: 40,
  weightUnit: FfiWeightUnit.Kilogram,
  weightStep: 2.5,
  weightDownKg: 37.5,
  weightUpKg: 42.5,
  warmUp: false,
};

const names = { current: 'Squat', previous: 'Deadlift', next: 'Row' };

/** The state with an optional field absent, as the engine answers it. */
function without(state: FfiFocusState, key: 'previous' | 'current'): FfiFocusState {
  const { [key]: _omitted, ...rest } = state;
  return rest as FfiFocusState;
}

function focus(overrides: Partial<FfiFocusState> = {}): FfiFocusState {
  return {
    phase: FfiFocusPhase.Set,
    current,
    previous: { exerciseCategory: 5, setsDone: 3, setCount: 3 },
    next: { exerciseCategory: 23, setsDone: 0, setCount: 4 },
    ...overrides,
  };
}

describe('StrengthFocusView', () => {
  it('shows the set in hand with the previous and next exercise', () => {
    const { getByTestId } = render(
      <StrengthFocusView focus={focus()} names={names} nowMs={0} onAdvance={jest.fn()} />
    );
    expect(getByTestId('strength-focus-exercise').props.children).toBe('Squat');
    expect(getByTestId('strength-focus-previous').props.children).toContain('Deadlift');
    expect(getByTestId('strength-focus-next').props.children).toContain('Row');
  });

  it('shows the time left in a timed rest', () => {
    const { getByTestId } = render(
      <StrengthFocusView
        focus={focus({
          phase: FfiFocusPhase.Rest,
          restStartedAt: 1_000,
          restSecs: 90,
          restEndsAt: 1_090,
        })}
        names={names}
        nowMs={1_030_000}
        onAdvance={jest.fn()}
      />
    );
    expect(getByTestId('strength-focus-rest').props.children).toBe('1:00');
  });

  it('shows no previous exercise on the first one', () => {
    const { queryByTestId } = render(
      <StrengthFocusView
        focus={without(focus(), 'previous')}
        names={{ ...names, previous: null }}
        nowMs={0}
        onAdvance={jest.fn()}
      />
    );
    expect(queryByTestId('strength-focus-previous')).toBeNull();
  });

  it('sends one advance when the set is done', () => {
    const onAdvance = jest.fn();
    const { getByTestId } = render(
      <StrengthFocusView focus={focus()} names={names} nowMs={0} onAdvance={onAdvance} />
    );
    fireEvent.press(getByTestId('strength-focus-advance'));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the session is finished', () => {
    const { queryByTestId } = render(
      <StrengthFocusView
        focus={without(focus({ phase: FfiFocusPhase.Finished }), 'current')}
        names={names}
        nowMs={0}
        onAdvance={jest.fn()}
      />
    );
    expect(queryByTestId('strength-focus')).toBeNull();
  });
});
