/**
 * Scenario: the athlete edits a review, its name or notes, and goes back
 * before saving.
 *
 * Expected behaviour: a manual entry's review asks before the edits go, and
 * goes once Discard is pressed. A stopped GPS ride's review leaves with no
 * prompt because its edits wait in the store and come back when it reopens,
 * but an edit made after its save landed is asked about. An untouched review
 * and one mid-upload leave with no prompt, and so does the return to the root
 * that Save and Discard make.
 */
import React from 'react';
import { Alert, Text, type AlertButton } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import ReviewScreen from '@/app/recording/review';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { StackActions } from 'expo-router/react-navigation';
import { testStack } from '../__shared__/testStack';

let mockParams: Record<string, string> = {};
const mockSave = { isUploading: false, queuedMessage: null as string | null };

jest.unmock('expo-router/react-navigation');
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), back: jest.fn() },
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
    isUploading: mockSave.isUploading,
    queuedMessage: mockSave.queuedMessage,
    errorMessage: null,
    handleSave: jest.fn(),
    canRetry: false,
  }),
}));

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockSave.isUploading = false;
  mockSave.queuedMessage = null;
  mockParams = {};
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  useRecordingStore.getState().reset();
});

function stoppedRide() {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  useRecordingStore.setState({ athleteId: 'i1' });
}

function manualEntry() {
  useRecordingStore.getState().startRecording('Yoga', 'manual');
  useRecordingStore.setState({ athleteId: 'i1' });
  mockParams = { manual: 'true', durationSeconds: '1800' };
}

afterEach(() => alertSpy.mockRestore());

function Root() {
  return <Text>root</Text>;
}

async function openReview() {
  const { element, ref } = testStack({ root: Root, review: ReviewScreen });
  const view = await render(element);
  await act(() => ref.current?.navigate('review'));
  const route = () => ref.current?.getCurrentRoute()?.name;
  const back = () => act(() => ref.current?.goBack());
  return { view, ref, route, back };
}

async function press(label: string) {
  const buttons = (alertSpy.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  const button = buttons.find((b) => b.text === label);
  if (!button) throw new Error(`no ${label} button`);
  await act(() => button.onPress?.());
}

describe('a manual entry review with unsaved edits', () => {
  beforeEach(manualEntry);

  it('asks before an edited name goes, and leaves on Discard', async () => {
    const { view, route, back } = await openReview();
    await fireEvent.changeText(
      view.getByTestId('review-activity-name'),
      'Hill repeats on the ridge'
    );

    await back();

    expect(route()).toBe('review');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    await press('common.keepEditing');
    expect(view.getByTestId('review-activity-name').props.value).toBe('Hill repeats on the ridge');

    await back();
    await press('common.discard');
    expect(route()).toBe('root');
  });

  it('asks before typed notes go', async () => {
    const { view, route, back } = await openReview();
    await fireEvent.changeText(view.getByTestId('review-notes'), 'Headwind the whole way out');

    await back();

    expect(route()).toBe('review');
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('leaves an untouched review with no prompt', async () => {
    const { route, back } = await openReview();

    await back();

    expect(route()).toBe('root');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('lets through the return to the root a Save or Discard makes', async () => {
    const { view, ref, route } = await openReview();
    await fireEvent.changeText(view.getByTestId('review-notes'), 'Headwind the whole way out');

    await act(() => ref.current?.dispatch(StackActions.popTo('root')));

    expect(route()).toBe('root');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('asks nothing once the save shows its queued message', async () => {
    const { view, route, back } = await openReview();
    mockSave.queuedMessage = 'recording.savedQueued';
    await fireEvent.changeText(view.getByTestId('review-notes'), 'Headwind the whole way out');

    await back();

    expect(route()).toBe('root');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('raises no discard prompt while the upload is in flight', async () => {
    const { view, back } = await openReview();
    mockSave.isUploading = true;
    await fireEvent.changeText(view.getByTestId('review-notes'), 'Headwind the whole way out');

    await back();

    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe('a stopped GPS ride review with unsaved edits', () => {
  beforeEach(stoppedRide);

  it('leaves with no prompt and reopens with the edits', async () => {
    const { view, ref, route, back } = await openReview();
    await fireEvent.changeText(view.getByTestId('review-notes'), 'Headwind the whole way out');

    await back();

    expect(route()).toBe('root');
    expect(alertSpy).not.toHaveBeenCalled();
    await act(() => ref.current?.navigate('review'));
    expect(view.getByTestId('review-notes').props.value).toBe('Headwind the whole way out');
  });

  it('leaves with no prompt once a save put the edits in the library', async () => {
    const { view, route, back } = await openReview();
    await fireEvent.changeText(view.getByTestId('review-notes'), 'Headwind the whole way out');
    const { athleteId, startTime } = useRecordingStore.getState();
    await act(() => useRecordingStore.getState().markSavedToLibrary(athleteId!, startTime!));

    await back();

    expect(route()).toBe('root');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('asks for an edit made after the save landed', async () => {
    const { view, route, back } = await openReview();
    const { athleteId, startTime } = useRecordingStore.getState();
    await act(() => useRecordingStore.getState().markSavedToLibrary(athleteId!, startTime!));
    await fireEvent.changeText(view.getByTestId('review-notes'), 'Tailwind home');

    await back();

    expect(route()).toBe('review');
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});
