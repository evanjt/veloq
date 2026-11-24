/**
 * Scenario: a lifter touches an exercise handle and the touch is cancelled before the drag ends.
 *
 * Expected behaviour: the card reports the touch down at once, so the list can hold still, and
 * reports the end even when the pan never finishes, so the list is never left locked.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { FfiWeightUnit, type FfiLiveStrengthExercise } from 'veloqrs';

import { StrengthExerciseCard } from '../StrengthExerciseCard';

const exercise = {
  displayName: 'Squat',
  sets: [],
  groupNo: undefined,
} as unknown as FfiLiveStrengthExercise;

function mount() {
  const calls = { start: jest.fn(), end: jest.fn(), drop: jest.fn() };
  render(
    <StrengthExerciseCard
      index={0}
      exercise={exercise}
      weightUnit={FfiWeightUnit.Kilogram}
      currentSet={undefined}
      hasPrevious={false}
      hasNext
      edit={jest.fn()}
      toggleDone={jest.fn()}
      onDragStart={calls.start}
      onDragEnd={calls.end}
      onDrop={calls.drop}
    />
  );
  return calls;
}

describe('StrengthExerciseCard drag', () => {
  it('reports touch down and the end of a cancelled pan without a drop', async () => {
    const calls = mount();
    fireGestureHandler(getByGestureTestId('strength-exercise-0-drag'), [
      { state: State.BEGAN },
      { state: State.FAILED },
    ]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(calls.start).toHaveBeenCalledTimes(1);
    expect(calls.end).toHaveBeenCalledTimes(1);
    expect(calls.drop).not.toHaveBeenCalled();
  });

  it('drops with the travel and then reports the end', async () => {
    const calls = mount();
    fireGestureHandler(getByGestureTestId('strength-exercise-0-drag'), [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationY: -80 },
      { state: State.END, translationY: -120 },
    ]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(calls.drop).toHaveBeenCalledWith(-120);
    expect(calls.end).toHaveBeenCalledTimes(1);
  });
});
