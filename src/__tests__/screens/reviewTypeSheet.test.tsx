/**
 * Scenario: the review screen opens the activity type sheet and applies the answer to its draft.
 *
 * Expected behaviour: a selection changes the draft's type and leaves the recording store's
 * type alone, and a cancelled sheet changes nothing.
 */
import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

import ReviewScreen from '@/app/recording/review';
import { answerSheet } from '../__shared__/answerSheet';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { ActivityType } from '@/types';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams: { request?: string } = {};

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
  useReviewSave: () => ({
    isUploading: false,
    isProcessing: false,
    queuedMessage: null,
    saveError: null,
    handleSave: jest.fn(),
    handleDiscard: jest.fn(),
    clearSaveError: jest.fn(),
  }),
}));

beforeEach(() => {
  mockPush.mockClear();
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  useRecordingStore.setState({ athleteId: 'i1' });
});

describe('review activity type sheet', () => {
  it('applies the selection to the draft and leaves the recording store alone', async () => {
    const review = render(<ReviewScreen />);
    const draftType = () => review.getByTestId('review-activity-type');
    fireEvent.press(draftType());
    expect(mockPush.mock.calls[0][0].pathname).toBe('sheets/activity-type');
    answerSheet(mockPush, mockParams, 'Run' as ActivityType);
    await waitFor(() => expect(within(draftType()).getByText('activityTypes.Run')).toBeTruthy());
    expect(useRecordingStore.getState().activityType).toBe('Ride');
  });

  it('keeps the draft when the sheet is dismissed', async () => {
    const review = render(<ReviewScreen />);
    const draftType = () => review.getByTestId('review-activity-type');
    fireEvent.press(draftType());
    answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(within(draftType()).getByText('activityTypes.Ride')).toBeTruthy();
  });
});
