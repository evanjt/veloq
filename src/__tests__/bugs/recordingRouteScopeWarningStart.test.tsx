/**
 * Scenario: an athlete whose upload scope is missing reaches the recording
 * route, sees the scope warning and continues past it.
 *
 * Expected behaviour: the route itself honours the continue. From the picker
 * the ride starts once, and from a one-tap surface the screen stays idle until
 * Start is pressed.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import RecordingScreen from '@/app/recording/[type]';
import { ENTRY_SCREEN_ENTRY, QUICKSTART_ENTRY } from '@/features/recording/lib/armCountdown';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { useAuthStore } from '@/shared/app/AuthStore';

let mockParams: Record<string, string | undefined> = { type: 'Ride' };

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), replaceTo: jest.fn() }));
jest.mock('@/features/recording', () => {
  const { Pressable } = require('react-native');
  return require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    RecordingGate: ({ onContinue }: { onContinue: () => void }) => (
      <Pressable testID="scope-continue" onPress={onContinue} />
    ),
    useAlwaysLocationPrompt: () => undefined,
    useCanRecord: () => ({ canRecord: false, reason: 'no_permission' }),
    usePermissionUpgrade: () => ({
      upgradePermissions: jest.fn(),
      isUpgrading: false,
      error: null,
    }),
  });
});
jest.mock('@/features/recording/components/RecordingMap', () => ({
  RecordingMap: () => null,
}));
jest.mock('@/features/recording/hooks/useLocationPermission', () => ({
  useLocationPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
}));
jest.mock('@/features/recording/components/DataFieldGrid', () => ({
  DataFieldGrid: () => null,
}));
jest.mock('@/features/recording/components/ControlBar', () => ({
  ControlBar: () => null,
}));

let starts = 0;
let unsubscribe: () => void;

beforeEach(() => {
  jest.useFakeTimers();
  useRecordingStore.getState().reset();
  useUploadPermissionStore.setState({ recordingWithoutScope: false });
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
  starts = 0;
  unsubscribe = useRecordingStore.subscribe((state, previous) => {
    if (state.startTime !== null && state.startTime !== previous.startTime) starts += 1;
  });
});

afterEach(() => {
  unsubscribe();
  useRecordingStore.getState().reset();
  useUploadPermissionStore.setState({ recordingWithoutScope: false });
  jest.useRealTimers();
});

it('starts the ride once from the picker after the athlete continues past the warning', () => {
  mockParams = { type: 'Ride' };
  render(<RecordingScreen />);
  expect(useRecordingStore.getState().status).toBe('idle');

  fireEvent.press(screen.getByTestId('scope-continue'));

  expect(useRecordingStore.getState().status).toBe('recording');
  act(() => jest.advanceTimersByTime(10_000));
  expect(starts).toBe(1);
});

it('leaves a one-tap start idle after the warning, however long the screen stays open', () => {
  mockParams = { type: 'Ride', from: QUICKSTART_ENTRY };
  render(<RecordingScreen />);

  fireEvent.press(screen.getByTestId('scope-continue'));

  act(() => jest.advanceTimersByTime(10_000));
  expect(useRecordingStore.getState().status).toBe('idle');
  expect(starts).toBe(0);
});

it('starts once from the entry screen Start after the athlete continues past the warning', () => {
  mockParams = { type: 'Ride', from: ENTRY_SCREEN_ENTRY };
  render(<RecordingScreen />);

  fireEvent.press(screen.getByTestId('scope-continue'));

  expect(useRecordingStore.getState().status).toBe('recording');
  act(() => jest.advanceTimersByTime(10_000));
  expect(starts).toBe(1);
});

it('starts nothing while the warning is still up', () => {
  mockParams = { type: 'Ride', from: QUICKSTART_ENTRY };
  render(<RecordingScreen />);
  act(() => jest.advanceTimersByTime(10_000));

  expect(screen.getByTestId('scope-continue')).toBeTruthy();
  expect(useRecordingStore.getState().status).toBe('idle');
  expect(starts).toBe(0);
});
