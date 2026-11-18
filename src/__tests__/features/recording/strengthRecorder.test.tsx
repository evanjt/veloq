/**
 * Scenario: recording a strength session on the phone, from the start screen to the finish.
 * Expected behaviour: the screen holds none of the session. Each tap sends one edit to the
 * engine's live session and the screen draws the session the engine answers with, so a change
 * the engine carries down a run of sets, or a group it makes, appears as the engine returned it.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { LiveStrengthSession, StrengthStartData } from 'veloqrs';

import { StrengthRecorder } from '@/features/recording/components/StrengthRecorder';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useAthlete: () => ({ data: { sex: 'M' } }),
}));

jest.mock('@/shared/app/useDiscardGuard', () => ({ useDiscardGuard: jest.fn() }));

jest.mock('@/features/recording/hooks/useRecordingKeepAwake', () => ({
  useRecordingKeepAwake: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

const mockConfirm = jest.fn();
jest.mock('@/shared/ui/dialog', () => ({
  ...jest.requireActual('@/shared/ui/dialog'),
  confirmAction: (options: unknown) => mockConfirm(options),
}));

jest.mock('@/features/strength', () => {
  const { Pressable, Text } = require('react-native');
  return {
    ExercisePicker: ({ onPick }: { onPick: (row: unknown) => void }) => (
      <Pressable
        testID="picker-row-curl"
        onPress={() => onPick({ category: 7, name: 4, displayName: 'Curl' })}
      >
        <Text>curl</Text>
      </Pressable>
    ),
    StrengthCardBodies: () => null,
  };
});

jest.mock('@/features/recording/components/ManualEntry', () => {
  const { View } = require('react-native');
  return { ManualEntry: () => <View testID="review-form" /> };
});

jest.mock('@/features/recording/components/RpeSlider', () => ({ RpeSlider: () => null }));

const mockFinishSession = jest.fn();
const mockSavedNoticeKey = jest.fn();
jest.mock('@/features/recording/lib/strengthFinish', () => ({
  finishStrengthSession: (input: unknown) => mockFinishSession(input),
  savedNoticeKey: (outcome: unknown) => mockSavedNoticeKey(outcome),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => ({ athleteId: 'i42' }) },
}));

const mockReturnTo = jest.fn();
jest.mock('@/shared/app/navigation', () => ({
  returnTo: (path: string) => mockReturnTo(path),
  navigateTo: jest.fn(),
}));

const mockShowNotice = jest.fn();
jest.mock('@/shared/ui/Notice', () => ({
  NOTICE_LONG_MS: 8000,
  showNotice: (options: unknown) => mockShowNotice(options),
}));

const mockRequestSyncRefresh = jest.fn();
jest.mock('@/shared/native/syncRefresh', () => ({
  requestSyncRefresh: () => mockRequestSyncRefresh(),
}));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const mockReadPlannedWorkout = jest.fn();
jest.mock('@/features/recording/lib/plannedWorkout', () => ({
  readPlannedWorkout: (id: number) => mockReadPlannedWorkout(id),
}));

const { strength } = jest.requireMock('veloqrs') as {
  strength: Record<string, jest.Mock>;
};

interface TestSet {
  reps?: number;
  weightKg?: number;
  displayWeight?: number;
  durationSecs?: number;
  warmUp: boolean;
  done: boolean;
}

function set(reps: number, weightKg: number, done = false): TestSet {
  return { reps, weightKg, displayWeight: weightKg, warmUp: false, done };
}

function exercise(displayName: string, sets: TestSet[], extra: Record<string, unknown> = {}) {
  return {
    category: 0,
    name: 1,
    labelKey: displayName.toLowerCase().replace(' ', '_'),
    displayName,
    equipment: 'barbell',
    oneSided: false,
    sets,
    ...extra,
  };
}

function session(exercises: ReturnType<typeof exercise>[], extra = {}): LiveStrengthSession {
  return {
    id: 'live-1',
    weightUnit: 0,
    begun: false,
    exercises,
    groups: [],
    currentExercise: 0,
    currentSet: 0,
    ...extra,
  } as unknown as LiveStrengthSession;
}

const START: StrengthStartData = {
  live: false,
  groups: [
    {
      signature: '0.1,23.2',
      times: 3,
      lastDoneDays: 4,
      latestActivityId: 'watch-9',
      muscles: [{ slug: 'chest', intensity: 2 }],
      equipment: ['barbell'],
      exerciseNames: ['Bench Press', 'Bent Over Row'],
    },
  ],
  workouts: [{ id: 'saved-1', name: 'Push day', exerciseCount: 4, setCount: 12 }],
  removed: [],
};

const BENCH_AND_ROW = session([
  exercise('Bench Press', [set(20, 40), set(20, 40), set(10, 40)]),
  exercise('Bent Over Row', [set(12, 30)]),
]);

function editsSent() {
  return strength.editLiveStrengthSession.mock.calls.map((call) => call[0]);
}

function answerNextEditWith(next: LiveStrengthSession, prefilledDaysAgo?: number) {
  strength.editLiveStrengthSession.mockReturnValueOnce({
    session: next,
    prefilledDaysAgo,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(strength).forEach((mock) => mock.mockReset());
  strength.getStrengthStartData.mockReturnValue(START);
  strength.getLiveStrengthSession.mockReturnValue(null);
});

function renderRecorder() {
  return render(<StrengthRecorder activityType="WeightTraining" />);
}

describe('the start screen', () => {
  it('offers past sessions grouped by their exercises and starts the latest of one', () => {
    strength.startLiveStrengthSession.mockReturnValue(BENCH_AND_ROW);
    renderRecorder();

    expect(screen.getByText('Bench Press, Bent Over Row')).toBeTruthy();
    expect(screen.getByText('strength.recorder.groupTimes:3')).toBeTruthy();
    expect(screen.getByText('Push day')).toBeTruthy();

    fireEvent.press(screen.getByTestId('strength-start-group-0'));

    expect(strength.startLiveStrengthSession).toHaveBeenCalledWith(
      { kind: 'Activity', id: 'watch-9' },
      expect.any(Number)
    );
    expect(screen.getByTestId('strength-set-0-0')).toBeTruthy();
    expect(screen.getByTestId('strength-set-1-0')).toBeTruthy();
  });

  it('starts a saved workout and a blank session', () => {
    strength.startLiveStrengthSession.mockReturnValue(session([]));
    renderRecorder();

    fireEvent.press(screen.getByTestId('strength-start-workout-0'));
    expect(strength.startLiveStrengthSession).toHaveBeenLastCalledWith(
      { kind: 'Workout', id: 'saved-1' },
      expect.any(Number)
    );
  });

  it('lists a removed workout and restores it once, then shows it among the saved ones', () => {
    const removedRow = { id: 'gone-1', name: 'Legs', exerciseCount: 3, setCount: 9 };
    strength.getStrengthStartData
      .mockReturnValueOnce({ ...START, workouts: [], removed: [removedRow] })
      .mockReturnValueOnce({ ...START, workouts: [removedRow], removed: [] });
    renderRecorder();

    expect(screen.getByText('strength.recorder.removedWorkouts')).toBeTruthy();
    expect(screen.getByText('Legs')).toBeTruthy();
    expect(screen.queryByTestId('strength-start-workout-0')).toBeNull();

    fireEvent.press(screen.getByTestId('strength-start-removed-restore-0'));

    expect(strength.recoverStrengthWorkout).toHaveBeenCalledTimes(1);
    expect(strength.recoverStrengthWorkout).toHaveBeenCalledWith('gone-1');
    expect(screen.queryByText('strength.recorder.removedWorkouts')).toBeNull();
    expect(screen.getByTestId('strength-start-workout-0')).toBeTruthy();
  });

  it('offers no removed section when nothing was removed', () => {
    renderRecorder();

    expect(screen.queryByText('strength.recorder.removedWorkouts')).toBeNull();
  });

  it('starts empty from the blank button', () => {
    strength.startLiveStrengthSession.mockReturnValue(session([]));
    renderRecorder();

    fireEvent.press(screen.getByTestId('strength-start-blank'));

    expect(strength.startLiveStrengthSession).toHaveBeenCalledWith(
      { kind: 'Blank' },
      expect.any(Number)
    );
  });

  it('starts from the planned workout, sending each line as the engine reads it', () => {
    mockReadPlannedWorkout.mockReturnValue({
      name: 'Upper day',
      lines: [
        { kind: 'work', text: 'Bench 18.5kg per hand 12/10/8', durationSeconds: null },
        { kind: 'rest', text: '', durationSeconds: 90 },
        { kind: 'work', text: 'Plank', durationSeconds: 60 },
      ],
    });
    strength.startLiveStrengthSessionFromPlan.mockReturnValue(BENCH_AND_ROW);
    render(<StrengthRecorder activityType="WeightTraining" pairedEventId={7} />);

    expect(mockReadPlannedWorkout).toHaveBeenCalledWith(7);
    fireEvent.press(screen.getByTestId('strength-start-plan'));

    expect(strength.startLiveStrengthSessionFromPlan).toHaveBeenCalledWith(
      ['Bench 18.5kg per hand 12/10/8', 'Rest 90 sec', 'Plank 60 sec'],
      expect.any(Number)
    );
    expect(screen.getByTestId('strength-set-0-0')).toBeTruthy();
  });

  it('offers no plan start when the event has no plan to read', () => {
    mockReadPlannedWorkout.mockReturnValue(null);
    render(<StrengthRecorder activityType="WeightTraining" pairedEventId={7} />);

    expect(screen.queryByTestId('strength-start-plan')).toBeNull();
    expect(screen.getByTestId('strength-start-blank')).toBeTruthy();
  });

  it('opens straight on the session the engine is holding', () => {
    strength.getLiveStrengthSession.mockReturnValue(BENCH_AND_ROW);
    renderRecorder();

    expect(screen.getByTestId('strength-set-0-0')).toBeTruthy();
    expect(strength.startLiveStrengthSession).not.toHaveBeenCalled();
  });
});

describe('the session screen', () => {
  beforeEach(() => {
    strength.getLiveStrengthSession.mockReturnValue(BENCH_AND_ROW);
  });

  it('adds a copy of a set below it when plus is tapped', () => {
    renderRecorder();
    answerNextEditWith(
      session([
        exercise('Bench Press', [set(20, 40), set(20, 40), set(20, 40), set(10, 40)]),
        exercise('Bent Over Row', [set(12, 30)]),
      ])
    );

    fireEvent.press(screen.getByTestId('strength-set-0-1-add'));

    expect(editsSent()).toEqual([{ kind: 'AddSet', exercise: 0, set: 1 }]);
    expect(screen.getByTestId('strength-set-0-3')).toBeTruthy();
  });

  it("draws the engine's flow-down result when a set's reps are stepped down", () => {
    renderRecorder();
    answerNextEditWith(
      session([
        exercise('Bench Press', [set(19, 40), set(19, 40), set(10, 40)]),
        exercise('Bent Over Row', [set(12, 30)]),
      ])
    );

    fireEvent.press(screen.getByTestId('strength-set-0-0-reps-minus'));

    expect(editsSent()).toEqual([{ kind: 'StepReps', exercise: 0, set: 0, value: -1 }]);
    expect(screen.getByTestId('strength-set-0-0-reps-value').props.accessibilityValue.text).toBe(
      '19'
    );
    expect(screen.getByTestId('strength-set-0-1-reps-value').props.accessibilityValue.text).toBe(
      '19'
    );
    expect(screen.getByTestId('strength-set-0-2-reps-value').props.accessibilityValue.text).toBe(
      '10'
    );
  });

  it('steps weight up and down through the engine', () => {
    renderRecorder();
    answerNextEditWith(BENCH_AND_ROW);
    answerNextEditWith(BENCH_AND_ROW);

    fireEvent.press(screen.getByTestId('strength-set-0-0-weight-plus'));
    fireEvent.press(screen.getByTestId('strength-set-1-0-weight-minus'));

    expect(editsSent()).toEqual([
      { kind: 'StepWeight', exercise: 0, set: 0, value: 1 },
      { kind: 'StepWeight', exercise: 1, set: 0, value: -1 },
    ]);
  });

  it('reads a pound athlete in pounds and sends a typed weight as the athlete entered it', () => {
    const pounds = session([exercise('Bench Press', [{ ...set(20, 40), displayWeight: 88.2 }])], {
      weightUnit: 1,
    });
    strength.getLiveStrengthSession.mockReturnValue(pounds);
    renderRecorder();
    answerNextEditWith(pounds);

    expect(screen.getByTestId('strength-set-0-0-weight-value').props.accessibilityValue.text).toBe(
      'strength.recorder.weightLb:88.2'
    );

    fireEvent.press(screen.getByTestId('strength-set-0-0-weight-open-keypad'));
    fireEvent.changeText(screen.getByTestId('strength-set-0-0-weight-entry'), '135');
    fireEvent.press(screen.getByTestId('strength-set-0-0-weight-confirm'));

    expect(editsSent()).toEqual([{ kind: 'SetWeightEntered', exercise: 0, set: 0, value: 135 }]);
    expect(screen.queryByTestId('strength-set-0-0-weight-entry')).toBeNull();
  });

  it('refuses a typed weight that is not a number and sends nothing', () => {
    renderRecorder();

    fireEvent.press(screen.getByTestId('strength-set-0-0-weight-open-keypad'));
    fireEvent.changeText(screen.getByTestId('strength-set-0-0-weight-entry'), 'abc');
    fireEvent.press(screen.getByTestId('strength-set-0-0-weight-confirm'));

    expect(editsSent()).toEqual([]);
    expect(screen.getByTestId('strength-set-0-0-weight-entry')).toBeTruthy();
  });

  it('steps a hold by duration instead of reps', () => {
    const hold = session([
      exercise('Plank', [{ durationSecs: 30, warmUp: false, done: false }], {
        equipment: 'bodyweight',
      }),
    ]);
    strength.getLiveStrengthSession.mockReturnValue(hold);
    renderRecorder();
    answerNextEditWith(hold);

    fireEvent.press(screen.getByTestId('strength-set-0-0-duration-plus'));

    expect(editsSent()).toEqual([{ kind: 'StepDuration', exercise: 0, set: 0, value: 1 }]);
    expect(screen.queryByTestId('strength-set-0-0-reps-plus')).toBeNull();
  });

  it('shows the exercises grouped when the engine answers with a group', () => {
    renderRecorder();
    answerNextEditWith(
      session([
        exercise('Bench Press', [set(20, 40)], { groupNo: 1 }),
        exercise('Bent Over Row', [set(12, 30)], { groupNo: 1 }),
      ])
    );

    act(() => {
      screen.getByTestId('strength-exercise-1-handle').props.onAccessibilityAction({
        nativeEvent: { actionName: 'groupWithPrevious' },
      });
    });

    expect(editsSent()).toEqual([{ kind: 'Group', exercise: 1, to: 0 }]);
    expect(screen.getAllByText('strength.recorder.groupLabel:1')).toHaveLength(1);
  });

  it('moves an exercise up or down by the accessibility actions on its handle', () => {
    renderRecorder();
    answerNextEditWith(BENCH_AND_ROW);
    answerNextEditWith(BENCH_AND_ROW);

    act(() => {
      screen.getByTestId('strength-exercise-1-handle').props.onAccessibilityAction({
        nativeEvent: { actionName: 'moveUp' },
      });
      screen.getByTestId('strength-exercise-0-handle').props.onAccessibilityAction({
        nativeEvent: { actionName: 'moveDown' },
      });
    });

    expect(editsSent()).toEqual([
      { kind: 'MoveExercise', exercise: 1, to: 0 },
      { kind: 'MoveExercise', exercise: 0, to: 1 },
    ]);
  });

  it('ticks a set done and starts the rest after it', () => {
    renderRecorder();
    answerNextEditWith(BENCH_AND_ROW);
    answerNextEditWith(session(BENCH_AND_ROW.exercises as never, { restStartedAt: 100 }));

    fireEvent.press(screen.getByTestId('strength-set-0-0-done'));

    expect(editsSent()).toEqual([
      { kind: 'CompleteSet', exercise: 0, set: 0 },
      { kind: 'StartRest' },
    ]);
    expect(screen.getByTestId('strength-rest-skip')).toBeTruthy();
  });

  it('starts no rest after the last set is done', () => {
    renderRecorder();
    answerNextEditWith(session(BENCH_AND_ROW.exercises as never, { currentExercise: undefined }));

    fireEvent.press(screen.getByTestId('strength-set-1-0-done'));

    expect(editsSent()).toEqual([{ kind: 'CompleteSet', exercise: 1, set: 0 }]);
  });

  it('reopens a done set that is tapped again', () => {
    strength.getLiveStrengthSession.mockReturnValue(
      session([exercise('Bench Press', [set(20, 40, true)])])
    );
    renderRecorder();
    answerNextEditWith(BENCH_AND_ROW);

    fireEvent.press(screen.getByTestId('strength-set-0-0-done'));

    expect(editsSent()).toEqual([{ kind: 'ReopenSet', exercise: 0, set: 0 }]);
  });

  it('does a tapped set next', () => {
    renderRecorder();
    answerNextEditWith(BENCH_AND_ROW);

    fireEvent.press(screen.getByTestId('strength-set-0-2-select'));

    expect(editsSent()).toEqual([{ kind: 'SelectSet', exercise: 0, set: 2 }]);
  });

  it('sets a warm-up and a side from the more menu of a set', () => {
    const oneArm = session([exercise('Single Arm Row', [set(10, 20)], { oneSided: true })]);
    strength.getLiveStrengthSession.mockReturnValue(oneArm);
    renderRecorder();
    answerNextEditWith(oneArm);
    answerNextEditWith(oneArm);

    fireEvent.press(screen.getByTestId('strength-set-0-0-more'));
    fireEvent.press(screen.getByTestId('strength-set-0-0-warm-up'));
    fireEvent.press(screen.getByTestId('strength-set-0-0-side-left'));

    expect(editsSent()).toEqual([
      { kind: 'SetWarmUp', exercise: 0, set: 0, flag: true },
      { kind: 'SetSide', exercise: 0, set: 0, text: 'left' },
    ]);
  });

  it('plans a rest for an exercise and removes a set and an exercise', () => {
    renderRecorder();
    answerNextEditWith(BENCH_AND_ROW);
    answerNextEditWith(BENCH_AND_ROW);
    answerNextEditWith(BENCH_AND_ROW);

    fireEvent.press(screen.getByTestId('strength-exercise-0-rest-plus'));
    fireEvent.press(screen.getByTestId('strength-set-0-0-more'));
    fireEvent.press(screen.getByTestId('strength-set-0-0-remove'));
    fireEvent.press(screen.getByTestId('strength-exercise-1-remove'));

    expect(editsSent()).toEqual([
      { kind: 'ExerciseRest', exercise: 0, value: 30 },
      { kind: 'RemoveSet', exercise: 0, set: 0 },
      { kind: 'RemoveExercise', exercise: 1 },
    ]);
  });

  it('plans the rest of a group once for the group', () => {
    strength.getLiveStrengthSession.mockReturnValue(
      session(
        [
          exercise('Bench Press', [set(20, 40)], { groupNo: 2 }),
          exercise('Bent Over Row', [set(12, 30)], { groupNo: 2 }),
        ],
        { groups: [{ groupNo: 2, restSecs: 60 }] }
      )
    );
    renderRecorder();
    answerNextEditWith(BENCH_AND_ROW);

    expect(screen.queryByTestId('strength-exercise-0-rest-plus')).toBeNull();
    fireEvent.press(screen.getByTestId('strength-group-2-rest-plus'));

    expect(editsSent()).toEqual([{ kind: 'GroupRest', groupNo: 2, value: 90 }]);
  });

  it('adds an exercise from the picker and says when its sets came from', () => {
    renderRecorder();
    answerNextEditWith(
      session([
        ...(BENCH_AND_ROW.exercises as never[]),
        exercise('Curl', [set(10, 15)], { category: 7, name: 4 }),
      ]),
      3
    );

    fireEvent.press(screen.getByTestId('strength-add-exercise'));
    fireEvent.press(screen.getByTestId('picker-row-curl'));

    expect(editsSent()).toEqual([{ kind: 'AddExercise', category: 7, name: 4 }]);
    expect(screen.getByTestId('strength-set-2-0')).toBeTruthy();
    expect(screen.getByText('strength.recorder.prefilled:3')).toBeTruthy();
  });

  it('keeps the session as it was when the engine refuses a change', () => {
    renderRecorder();
    strength.editLiveStrengthSession.mockImplementationOnce(() => {
      throw new Error('no set 9 of exercise 0');
    });

    fireEvent.press(screen.getByTestId('strength-set-0-0-reps-plus'));

    expect(screen.getByTestId('strength-set-0-2')).toBeTruthy();
    expect(screen.getByText('strength.recorder.refused')).toBeTruthy();
  });

  it('discards the session after a confirmation and returns to the start screen', () => {
    renderRecorder();

    fireEvent.press(screen.getByTestId('strength-discard'));
    expect(strength.discardLiveStrengthSession).not.toHaveBeenCalled();
    act(() => (mockConfirm.mock.calls[0]![0] as { onConfirm: () => void }).onConfirm());

    expect(strength.discardLiveStrengthSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('strength-start-blank')).toBeTruthy();
  });

  it('opens the review on finish and drops the session once the review is left unsaved', () => {
    const view = renderRecorder();

    fireEvent.press(screen.getByTestId('strength-finish'));
    expect(screen.getByTestId('strength-review-save')).toBeTruthy();
    expect(strength.discardLiveStrengthSession).not.toHaveBeenCalled();

    view.unmount();
    expect(strength.discardLiveStrengthSession).toHaveBeenCalledTimes(1);
  });
});

describe('saving the review', () => {
  const entry = { id: 'r-1' };

  async function saveReview() {
    const view = renderRecorder();
    fireEvent.press(screen.getByTestId('strength-finish'));
    fireEvent.changeText(screen.getByTestId('strength-review-name'), 'Leg day');
    await act(async () => {
      fireEvent.press(screen.getByTestId('strength-review-save'));
    });
    return view;
  }

  beforeEach(() => {
    mockFinishSession.mockReset();
    mockSavedNoticeKey.mockReset();
    mockReturnTo.mockReset();
    mockShowNotice.mockReset();
    mockRequestSyncRefresh.mockReset();
    strength.getLiveStrengthSession.mockReturnValue(BENCH_AND_ROW);
  });

  it('finishes the session through the engine under the signed-in athlete, not the manual form', async () => {
    mockFinishSession.mockResolvedValue({ kind: 'saved', entry, kept: null, upload: null });
    mockSavedNoticeKey.mockReturnValue(null);

    const view = await saveReview();

    expect(mockFinishSession).toHaveBeenCalledWith({
      name: 'Leg day',
      rpe: null,
      athleteId: 'i42',
    });
    expect(screen.queryByTestId('review-form')).toBeNull();
    expect(mockRequestSyncRefresh).toHaveBeenCalledTimes(1);
    expect(mockShowNotice).not.toHaveBeenCalled();
    expect(mockReturnTo).toHaveBeenCalledWith('/');
    view.unmount();
    expect(strength.discardLiveStrengthSession).not.toHaveBeenCalled();
  });

  it('says where a session waits when it did not upload', async () => {
    mockFinishSession.mockResolvedValue({ kind: 'saved', entry, kept: null, upload: null });
    mockSavedNoticeKey.mockReturnValue('recording.savedQueued');

    await saveReview();

    expect(mockShowNotice).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'recording.savedQueued' })
    );
    expect(mockRequestSyncRefresh).not.toHaveBeenCalled();
    expect(mockReturnTo).toHaveBeenCalledWith('/');
  });

  it('falls back to the manual form and drops the live session when no set was done', async () => {
    mockFinishSession.mockResolvedValue({ kind: 'noSets' });

    await saveReview();

    expect(screen.getByTestId('review-form')).toBeTruthy();
    expect(strength.discardLiveStrengthSession).toHaveBeenCalledTimes(1);
    expect(mockReturnTo).not.toHaveBeenCalled();
  });

  it('keeps the review open and the session live when the engine refuses the finish', async () => {
    mockFinishSession.mockRejectedValue(new Error('no strength session is live'));

    const view = await saveReview();

    expect(screen.getByTestId('strength-review-save')).toBeTruthy();
    expect(mockReturnTo).not.toHaveBeenCalled();
    expect(strength.discardLiveStrengthSession).not.toHaveBeenCalled();
    view.unmount();
  });
});
