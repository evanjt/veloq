/**
 * Scenario: an athlete on the review screen presses Discard, with a tap, a
 * screen reader's double tap or a switch, none of which holds a touch down.
 *
 * Expected behaviour: Discard is a button that raises a confirmation with a
 * destructive accept. Cancel leaves the ride as it was. The accept fires one
 * medium impact, drops the ride from the store, deletes its backup and goes
 * home.
 */
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import ReviewScreen from '@/app/recording/review';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import * as haptics from '@/shared/ui/haptics';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: jest.fn(),
    back: jest.fn(),
    replace: (...a: unknown[]) => mockReplace(...a),
  },
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
  replaceTo: (...a: unknown[]) => mockReplace(...a),
  tapBack: jest.fn(),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/shared/ui/haptics', () => ({
  ...jest.requireActual('@/shared/ui/haptics'),
  medium: jest.fn(),
  success: jest.fn(),
}));
jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingBackup'),
  clearRecordingBackup: jest.fn(async () => {}),
}));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    useUploadPermissionStore: (selector: (state: object) => unknown) =>
      selector({ recordingWithoutScope: false, continueWithoutScope: jest.fn() }),
  })
);
jest.mock('@/features/recording/components/ReviewMapHero', () => ({ ReviewMapHero: () => null }));
let mockUploading = false;
jest.mock('@/features/recording/hooks/useReviewSave', () => ({
  useReviewSave: () => ({
    isUploading: mockUploading,
    errorMessage: null,
    queuedMessage: null,
    showPermissionFix: false,
    isOAuthLoading: false,
    handleUpgradeToOAuth: jest.fn(),
    canRetry: false,
    handleSave: jest.fn(),
  }),
}));

const mockClearBackup = clearRecordingBackup as jest.Mock;
const mockMedium = haptics.medium as jest.Mock;
let alertSpy: jest.SpyInstance;

function stoppedRide() {
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  useRecordingStore.setState({ athleteId: 'i1' });
}

/** Press Discard and return the buttons of the alert it raised. */
function pressDiscard(review: ReturnType<typeof render>): AlertButton[] {
  fireEvent.press(review.getByTestId('review-discard-button'));
  expect(alertSpy).toHaveBeenCalledTimes(1);
  return alertSpy.mock.calls[0][2] as AlertButton[];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUploading = false;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  stoppedRide();
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('review screen discard', () => {
  it('is a button a screen reader can name and activate', () => {
    const review = render(<ReviewScreen />);
    const discard = review.getByTestId('review-discard-button');

    expect(discard.props.accessibilityRole).toBe('button');
    expect(discard.props.accessibilityLabel).toBe('recording.discard');
  });

  it('raises a confirmation with a cancel and a destructive accept, and acts on neither yet', () => {
    const review = render(<ReviewScreen />);
    const buttons = pressDiscard(review);

    expect(alertSpy.mock.calls[0][0]).toBe('recording.discardConfirmTitle');
    expect(alertSpy.mock.calls[0][1]).toBe('recording.discardConfirmMessage');
    expect(buttons.map((b) => b.style)).toEqual(['cancel', 'destructive']);
    expect(useRecordingStore.getState().status).toBe('stopped');
    expect(mockClearBackup).not.toHaveBeenCalled();
    expect(mockMedium).not.toHaveBeenCalled();
  });

  it('leaves the ride untouched on cancel', () => {
    const review = render(<ReviewScreen />);
    const before = useRecordingStore.getState();
    const cancel = pressDiscard(review).find((b) => b.style === 'cancel');

    cancel?.onPress?.();

    const after = useRecordingStore.getState();
    expect(after.status).toBe('stopped');
    expect(after.startTime).toBe(before.startTime);
    expect(after.athleteId).toBe('i1');
    expect(mockClearBackup).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockMedium).not.toHaveBeenCalled();
  });

  it('drops the ride, deletes its backup and goes home on the accept, with one medium impact', () => {
    const review = render(<ReviewScreen />);
    const accept = pressDiscard(review).find((b) => b.style === 'destructive');

    accept?.onPress?.();

    expect(useRecordingStore.getState().status).toBe('idle');
    expect(mockClearBackup).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockMedium).toHaveBeenCalledTimes(1);
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('does nothing on an accept that lands after the ride has already gone', () => {
    const review = render(<ReviewScreen />);
    const accept = pressDiscard(review).find((b) => b.style === 'destructive');

    useRecordingStore.getState().reset();
    stoppedRide();
    useRecordingStore.setState({ startTime: (useRecordingStore.getState().startTime ?? 0) + 1 });
    accept?.onPress?.();

    expect(useRecordingStore.getState().status).toBe('stopped');
    expect(mockClearBackup).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('refuses the press while a save is in flight', () => {
    mockUploading = true;
    const review = render(<ReviewScreen />);
    const discard = review.getByTestId('review-discard-button');

    expect(discard.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(discard);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
