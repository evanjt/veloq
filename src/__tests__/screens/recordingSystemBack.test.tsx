/**
 * Scenario: Android's back key and edge gesture reach the stack as a go-back action, which the
 * screen-level swipe setting does not govern. The live screen locks itself when a ride starts,
 * and the review hides its own back control while an upload is in flight.
 *
 * Expected behaviour: a go-back on the locked live screen mid-ride leaves the screen mounted with
 * the unlock track showing, and a go-back on the review mid-upload leaves the review mounted.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack } from 'expo-router';

import RecordingScreen from '@/app/recording/[type]';
import ReviewScreen from '@/app/recording/review';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';

let mockUploading = false;

jest.unmock('expo-router');
jest.unmock('expo-router/react-navigation');
// The router test library swaps reanimated for its mock, which has no useReducedMotion.
jest.mock('react-native-reanimated/mock', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    useAlwaysLocationPrompt: () => undefined,
    useCanRecord: () => ({ canRecord: true, reason: 'ok' }),
    usePermissionUpgrade: () => ({
      upgradePermissions: jest.fn(),
      isUpgrading: false,
      error: null,
    }),
    useUploadPermissionStore: (selector: (state: object) => unknown) =>
      selector({ recordingWithoutScope: false, continueWithoutScope: jest.fn() }),
    useReviewSave: () => ({
      isUploading: mockUploading,
      isProcessing: mockUploading,
      queuedMessage: null,
      saveError: null,
      handleSave: jest.fn(),
      handleDiscard: jest.fn(),
      clearSaveError: jest.fn(),
    }),
  })
);
jest.mock('@/features/recording/components/RecordingMap', () => ({ RecordingMap: () => null }));
jest.mock('@/features/recording/components/ReviewMapHero', () => ({ ReviewMapHero: () => null }));
jest.mock('@/features/recording/hooks/useLocationPermission', () => ({
  useLocationPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
}));
jest.mock('@/features/recording/hooks/useGpsSessionEffect', () => ({
  useGpsSessionEffect: () => undefined,
}));
jest.mock('@/features/recording/components/ConnectedDataFieldGrid', () => ({
  ConnectedDataFieldGrid: () => null,
}));

let app: ReturnType<typeof renderRouter>;

async function renderRecordingStack(path: string) {
  app = renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>feed</Text>,
      'recording/[type]': () => <RecordingScreen />,
      'recording/review': () => <ReviewScreen />,
    },
    { initialUrl: '/' }
  );
  await act(() => router.push(path));
  expect(app.getPathname()).toBe(path);
}

beforeEach(() => {
  mockUploading = false;
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'athlete-a' });
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.setState({ athleteId: 'athlete-a' });
});

afterEach(() => {
  useRecordingStore.getState().reset();
});

describe('the locked live screen', () => {
  it('stays mounted on back mid-ride', async () => {
    await renderRecordingStack('/recording/Ride');
    expect(screen.getByTestId('recording-unlock-slot')).toBeTruthy();

    await act(() => router.back());

    expect(app.getPathname()).toBe('/recording/Ride');
    expect(screen.getByTestId('recording-unlock-slot')).toBeTruthy();
    expect(useRecordingStore.getState().status).toBe('recording');
  });

  it('stays mounted on back while paused', async () => {
    await act(() => useRecordingStore.getState().pauseRecording());
    await renderRecordingStack('/recording/Ride');

    await act(() => router.back());
    await act(() => router.back());

    expect(app.getPathname()).toBe('/recording/Ride');
    expect(useRecordingStore.getState().status).toBe('paused');
  });
});

describe('the review', () => {
  beforeEach(() => {
    useRecordingStore.getState().stopRecording();
  });

  it('stays mounted on back while the upload is in flight', async () => {
    mockUploading = true;
    await renderRecordingStack('/recording/review');

    await act(() => router.back());

    expect(app.getPathname()).toBe('/recording/review');
  });

  it('goes back once nothing is processing', async () => {
    await renderRecordingStack('/recording/review');

    await act(() => router.back());

    expect(app.getPathname()).toBe('/');
  });
});
