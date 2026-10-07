/**
 * Scenario: the athlete taps today's planned run, which opens the recording
 * route paired to it.
 *
 * Expected behaviour: the screen shows the current step and its target over
 * the ordered list, keeps the recording controls, freezes the countdown while
 * paused, keeps recording after the last step, and Stop reaches the paired
 * review. A plan with nothing to follow leaves an ordinary recording.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import RecordingScreen from '@/app/recording/[type]';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { navigateTo } from '@/shared/app/navigation';
import { useAuthStore } from '@/shared/app/AuthStore';

let mockParams: Record<string, string | undefined> = {};
let mockBodies: string[] = [];
const mockScreenColorsRender = jest.fn();

jest.mock('@/features/recording/hooks/useRecordingScreenColors', () => {
  const actual = jest.requireActual('@/features/recording/hooks/useRecordingScreenColors');
  return {
    ...actual,
    useRecordingScreenColors: () => {
      mockScreenColorsRender();
      return actual.useRecordingScreenColors();
    },
  };
});

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getCalendarEventBodies: () => mockBodies, subscribe: () => () => {} }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), replaceTo: jest.fn() }));
// A render error surfaces as itself rather than as the boundary's fallback.
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: <P extends object>(Screen: React.ComponentType<P>) => Screen,
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  moveAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => ''),
  deleteAsync: jest.fn(async () => undefined),
}));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    useAlwaysLocationPrompt: () => undefined,
    useCanRecord: () => ({ canRecord: true, reason: 'ok' }),
    usePermissionUpgrade: () => ({
      upgradePermissions: jest.fn(),
      isUpgrading: false,
      error: null,
    }),
  })
);
jest.mock('@/features/recording/components/RecordingMap', () => ({
  RecordingMap: () => {
    const { View } = require('react-native');
    return <View testID="recording-map" />;
  },
}));
jest.mock('@/features/recording/hooks/useLocationPermission', () => ({
  useLocationPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
}));
jest.mock('@/features/recording/components/UnlockTrack', () => ({
  UnlockTrack: ({ onUnlock }: { onUnlock: () => void }) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="unlock" onPress={onUnlock} />;
  },
}));
jest.mock('@/features/recording/components/DataFieldGrid', () => ({
  DataFieldGrid: () => null,
}));

const TODAY = new Date();
const event = (steps: unknown) =>
  JSON.stringify({
    id: 7,
    name: 'Kilometre repeats',
    category: 'WORKOUT',
    type: 'Run',
    start_date_local: TODAY.toISOString().slice(0, 19),
    workout_doc: { steps, lthr: 170 },
  });

const plannedRun = [
  { text: 'Warm up', duration: 120, hr: { start: 70, end: 80, units: '%lthr' } },
  { text: 'Kilometre', distance: 1000, duration: 300, pace: { value: 95, units: '%pace' } },
];

beforeEach(() => {
  jest.useFakeTimers();
  mockScreenColorsRender.mockClear();
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
  (navigateTo as jest.Mock).mockClear();
});

it('advances the timer without rendering the recording screen on each clock tick', () => {
  mockBodies = [];
  mockParams = { type: 'Ride' };
  render(<RecordingScreen />);

  expect(useRecordingStore.getState().status).toBe('recording');
  expect(screen.getByTestId('recording-timer')).toHaveTextContent('00:00');
  const rootRenders = mockScreenColorsRender.mock.calls.length;

  act(() => jest.advanceTimersByTime(5000));

  expect(screen.getByTestId('recording-timer')).toHaveTextContent('00:05');
  expect(mockScreenColorsRender.mock.calls.length).toBe(rootRenders);
});

afterEach(() => {
  useRecordingStore.getState().reset();
  jest.useRealTimers();
});

it('follows the planned run beside the map and controls, and Stop reaches the paired review', async () => {
  mockBodies = [event(plannedRun)];
  mockParams = { type: 'Run', pairedEventId: '7' };
  render(<RecordingScreen />);

  expect(useRecordingStore.getState().status).toBe('recording');
  expect(screen.getByTestId('workout-current-step')).toHaveTextContent('Warm up');
  expect(screen.getByTestId('workout-current-target')).toHaveTextContent(
    '70–80% LTHR (119–136 bpm)'
  );
  expect(screen.getByTestId('workout-step-list')).toHaveTextContent(/Warm up.*Kilometre/);
  expect(screen.getByTestId('recording-map')).toBeTruthy();
  fireEvent.press(screen.getByTestId('unlock'));
  expect(screen.getByTestId('control-stop')).toBeTruthy();

  // A calendar refresh that changes the event does not move the plan in hand.
  mockBodies = [event([{ text: 'Something else', duration: 60 }])];

  act(() => jest.advanceTimersByTime(30_000));
  expect(screen.getByTestId('workout-countdown')).toHaveTextContent('1:30');

  fireEvent.press(screen.getByTestId('control-pause'));
  act(() => jest.advanceTimersByTime(60_000));
  expect(screen.getByTestId('workout-countdown')).toHaveTextContent('1:30');
  fireEvent.press(screen.getByTestId('control-resume'));

  fireEvent.press(screen.getByTestId('workout-next'));
  expect(screen.getByTestId('workout-current-step')).toHaveTextContent('Kilometre');
  expect(screen.getByTestId('workout-current-target')).toHaveTextContent('95% pace');

  fireEvent.press(screen.getByTestId('workout-next'));
  expect(screen.getByTestId('workout-complete')).toBeTruthy();
  expect(useRecordingStore.getState().status).toBe('recording');

  await act(async () => {
    fireEvent.press(screen.getByTestId('control-stop'));
  });
  expect(useRecordingStore.getState().status).toBe('stopped');
  expect(useRecordingStore.getState().pairedEventId).toBe(7);
  expect(navigateTo).toHaveBeenCalledWith('/recording/review');
});

it('records an ordinary run when the planned event has nothing to follow', () => {
  for (const bodies of [[event([])], ['{not json'], []]) {
    mockBodies = bodies;
    mockParams = { type: 'Run', pairedEventId: '7' };
    const view = render(<RecordingScreen />);
    expect(useRecordingStore.getState().status).toBe('recording');
    expect(useRecordingStore.getState().pairedEventId).toBe(7);
    expect(screen.queryByTestId('workout-guide')).toBeNull();
    fireEvent.press(screen.getByTestId('unlock'));
    expect(screen.getByTestId('control-stop')).toBeTruthy();
    view.unmount();
    useRecordingStore.getState().reset();
  }
});
