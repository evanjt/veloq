/**
 * Scenario: a strength session runs on an iPhone with the phone locked.
 * Expected behaviour: the engine's rest end schedules one alert, the lock-screen card shows the rest
 * and its end, ending the rest cancels the alert and ends the card, and a heart rate reading
 * reaches the engine only once the session has begun.
 */
import { Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import {
  FfiFocusPhase,
  FfiWeightUnit,
  type FfiFocusState,
  type FfiLiveStrengthSession,
} from 'veloqrs';

import { useStrengthFocus } from '@/features/recording/hooks/useStrengthFocus';
import { useStrengthHeartRate } from '@/features/recording/hooks/useStrengthHeartRate';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

jest.mock('@/features/recording/lib/recordingNotification', () => ({
  updateStrengthNotification: jest.fn(),
  clearRecordingNotification: jest.fn(),
}));

jest.mock('@/features/recording/lib/liveActivity/bridge', () => ({
  isLiveActivitySupported: jest.fn(() => true),
  startNativeLiveActivity: jest.fn(() => 'card'),
  updateNativeLiveActivity: jest.fn(),
  endNativeLiveActivity: jest.fn(),
  endAllNativeLiveActivities: jest.fn(),
  onLiveActivityControl: jest.fn(),
}));

const mockBridge = require('@/features/recording/lib/liveActivity/bridge');
const Notifications = require('expo-notifications');
const { strength } = require('veloqrs');

const REST_ENDS_AT = 1_800_000_090;

const session = {
  startedAt: 1_800_000_000,
  currentExercise: 0,
  exercises: [{ displayName: 'Squat', sets: [] }],
} as unknown as FfiLiveStrengthSession;

function focus(overrides: Partial<FfiFocusState>): FfiFocusState {
  return {
    phase: FfiFocusPhase.Rest,
    current: {
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
    },
    restStartedAt: 1_800_000_000,
    restSecs: 90,
    restEndsAt: REST_ENDS_AT,
    ...overrides,
  } as FfiFocusState;
}

function setPhase(): FfiFocusState {
  const { restStartedAt: _a, restSecs: _b, restEndsAt: _c, ...rest } = focus({});
  return { ...rest, phase: FfiFocusPhase.Set } as FfiFocusState;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(1_800_000_010_000);
});
afterEach(() => jest.useRealTimers());
Platform.OS = 'ios';

describe('strength session on the lock screen', () => {
  it('schedules one rest-end alert at the engine rest end', async () => {
    renderHook(() => useStrengthFocus(session, focus({})));
    await act(async () => {});
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const request = Notifications.scheduleNotificationAsync.mock.calls[0][0];
    expect(request.trigger.date).toEqual(new Date(REST_ENDS_AT * 1000));
  });

  it('shows the rest on the lock-screen card with its end', () => {
    renderHook(() => useStrengthFocus(session, focus({})));
    expect(mockBridge.startNativeLiveActivity).toHaveBeenCalledTimes(1);
    const state = JSON.parse(mockBridge.startNativeLiveActivity.mock.calls[0][1]);
    expect(state).toMatchObject({
      phase: 'rest',
      exercise: 'Squat',
      restEndsAt: REST_ENDS_AT * 1000,
    });
  });

  it('cancels the alert and moves the card to the set when the rest ends', async () => {
    const { rerender } = renderHook(({ f }: { f: FfiFocusState }) => useStrengthFocus(session, f), {
      initialProps: { f: focus({}) },
    });
    await act(async () => {});
    rerender({
      f: setPhase(),
    });
    await act(async () => {});
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockBridge.updateNativeLiveActivity.mock.calls[0][0])).toMatchObject({
      phase: 'set',
      restEndsAt: null,
    });
  });

  it('ends the card and the alert when the session ends', async () => {
    const { unmount } = renderHook(() => useStrengthFocus(session, focus({})));
    await act(async () => {});
    unmount();
    await act(async () => {});
    expect(mockBridge.endNativeLiveActivity).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  });
});

describe('strength session heart rate', () => {
  beforeEach(() => {
    useRecordingStore.setState({ latestSensor: {} } as never);
  });

  it('sends a reading to the engine once the session has begun', () => {
    renderHook(() => useStrengthHeartRate(session));
    act(() => useRecordingStore.getState().setSensorSample('heartrate', 132));
    expect(strength.recordLiveHeartRate).toHaveBeenCalledWith(132, 1_800_000_010);
  });

  it('sends nothing before Begin', () => {
    renderHook(() => useStrengthHeartRate({ ...session, startedAt: undefined } as never));
    act(() => useRecordingStore.getState().setSensorSample('heartrate', 132));
    expect(strength.recordLiveHeartRate).not.toHaveBeenCalled();
  });

  it('sends each reading once', () => {
    const { rerender } = renderHook(() => useStrengthHeartRate(session));
    act(() => useRecordingStore.getState().setSensorSample('heartrate', 132));
    rerender({});
    expect(strength.recordLiveHeartRate).toHaveBeenCalledTimes(1);
  });
});
