/**
 * Scenario: the review screen offers Discard as a hold, which throws the
 * unsaved ride away. A touch that lands on it while the athlete scrolls the
 * screen is not a discard.
 *
 * Expected behaviour: touching Discard fires nothing; a hold that completes
 * fires one medium impact, the destructive accept, and never the success
 * notification a save plays; a touch the scroll takes over discards nothing.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import ReviewScreen from '@/app/recording/review';
import * as haptics from '@/shared/ui/haptics';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const mockReplace = jest.fn();

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
  onPullRefresh: (handler: unknown) => handler,
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a) },
  useLocalSearchParams: () => ({}),
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
jest.mock('@/shared/app/navigation', () => ({
  navigateTo: jest.fn(),
  replaceTo: jest.fn(),
  tapBack: jest.fn(),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    useUploadPermissionStore: (selector: (state: object) => unknown) =>
      selector({ recordingWithoutScope: false, continueWithoutScope: jest.fn() }),
  })
);
jest.mock('@/features/recording/components/ReviewMapHero', () => ({ ReviewMapHero: () => null }));
jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  clearRecordingBackup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/recording/hooks/useReviewSave', () => ({
  useReviewSave: () => ({
    isUploading: false,
    isProcessing: false,
    queuedMessage: null,
    saveError: null,
    handleSave: jest.fn(),
    clearSaveError: jest.fn(),
  }),
}));

/** A finger landing: the raw touch and the press it begins. */
function touchDown(target: ReturnType<ReturnType<typeof render>['getByTestId']>) {
  fireEvent(target, 'touchStart');
  fireEvent(target, 'pressIn');
}

function fired() {
  return {
    selection: (haptics.selection as jest.Mock).mock.calls.length,
    light: (haptics.light as jest.Mock).mock.calls.length,
    medium: (haptics.medium as jest.Mock).mock.calls.length,
    success: (haptics.success as jest.Mock).mock.calls.length,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  useRecordingStore.setState({ athleteId: 'i1' });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('review screen discard hold', () => {
  it('fires nothing when the finger lands on Discard', () => {
    const review = render(<ReviewScreen />);

    touchDown(review.getByTestId('review-discard-button'));

    expect(fired()).toEqual({ selection: 0, light: 0, medium: 0, success: 0 });
    expect(useRecordingStore.getState().status).toBe('stopped');
  });

  it('discards with one medium impact and no success notification', () => {
    const review = render(<ReviewScreen />);
    const discard = review.getByTestId('review-discard-button');

    touchDown(discard);
    fireEvent(discard, 'longPress');

    expect(fired()).toEqual({ selection: 0, light: 0, medium: 1, success: 0 });
    expect(useRecordingStore.getState().status).toBe('idle');
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('discards nothing when the touch is taken by a scroll before the hold completes', () => {
    const review = render(<ReviewScreen />);
    const discard = review.getByTestId('review-discard-button');

    touchDown(discard);
    fireEvent(discard, 'pressOut');
    fireEvent(discard, 'touchCancel');
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(fired()).toEqual({ selection: 0, light: 0, medium: 0, success: 0 });
    expect(useRecordingStore.getState().status).toBe('stopped');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
