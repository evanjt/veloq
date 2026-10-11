/**
 * Scenario: a GPS ride reaches the review screen, and a manual or strength entry reaches it
 * carrying the effort the athlete chose on the screen before.
 *
 * Expected behaviour: the screen offers no effort slider, and an effort carried in hands its
 * value to the save rather than dropping it.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import ReviewScreen from '@/app/recording/review';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
const mockSaveArgs = jest.fn();

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), replaceTo: jest.fn() }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    useUploadPermissionStore: (selector: (state: object) => unknown) =>
      selector({ recordingWithoutScope: false, continueWithoutScope: jest.fn() }),
  })
);
jest.mock('@/features/recording/components/ReviewMapHero', () => ({ ReviewMapHero: () => null }));
jest.mock('@/features/recording/hooks/useReviewSave', () => ({
  useReviewSave: (args: unknown) => {
    mockSaveArgs(args);
    return {
      isUploading: false,
      isProcessing: false,
      queuedMessage: null,
      saveError: null,
      handleSave: jest.fn(),
      handleDiscard: jest.fn(),
      clearSaveError: jest.fn(),
    };
  },
}));

function stoppedRide() {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  useRecordingStore.setState({ athleteId: 'i1' });
}

function manualEntry() {
  useRecordingStore.getState().startRecording('WeightTraining', 'manual');
  useRecordingStore.setState({ athleteId: 'i1' });
}

function savedEffort() {
  return mockSaveArgs.mock.calls.at(-1)?.[0].rpe;
}

beforeEach(() => {
  mockPush.mockClear();
  mockSaveArgs.mockClear();
  mockParams = {};
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  useRecordingStore.getState().reset();
});

describe('review screen effort rating', () => {
  it('shows no effort slider for a GPS ride', () => {
    stoppedRide();
    const review = render(<ReviewScreen />);
    expect(review.queryByTestId('review-rpe')).toBeNull();
  });

  it('saves no effort for a GPS ride', () => {
    stoppedRide();
    render(<ReviewScreen />);
    expect(savedEffort()).toBeNull();
  });

  it('hands the effort a manual entry carries to the save', () => {
    manualEntry();
    mockParams = { manual: 'true', durationSeconds: '1800', rpe: '7' };
    render(<ReviewScreen />);
    expect(savedEffort()).toBe(7);
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['not a number', 'hard'],
    ['below the scale', '0'],
    ['above the scale', '11'],
    ['fractional', '6.5'],
  ])('saves no effort when the carried value is %s', (_label, rpe) => {
    manualEntry();
    mockParams = { manual: 'true', durationSeconds: '1800', ...(rpe === undefined ? {} : { rpe }) };
    render(<ReviewScreen />);
    expect(savedEffort()).toBeNull();
  });

  it('keeps the scale ends', () => {
    manualEntry();
    mockParams = { manual: 'true', durationSeconds: '1800', rpe: '1' };
    render(<ReviewScreen />);
    expect(savedEffort()).toBe(1);
    mockParams = { ...mockParams, rpe: '10' };
    render(<ReviewScreen />);
    expect(savedEffort()).toBe(10);
  });
});
