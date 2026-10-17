/**
 * Scenario: an athlete on the review screen renames the ride, writes notes,
 * changes the sport and trims the ends, and a rejected credential signs them
 * out before they save. The ride is held, and they sign in again as themselves.
 *
 * Expected behaviour: the reopened review carries the name, notes, sport and
 * trim they left, and an app kill on review keeps them too.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import ReviewScreen from '@/app/recording/review';
import { resumeHeldRecordingForAthlete } from '@/features/recording/lib/holdRecordingOnSignOut';
import { loadRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { RecordingStreams } from '@/features/recording/types';
import { inStack } from '../__shared__/testStack';

const mockFiles = new Map<string, string>();
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const content = mockFiles.get(from);
    if (content === undefined) throw new Error('ENOENT');
    mockFiles.set(to, content);
    mockFiles.delete(from);
  }),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => {
    mockFiles.set(path, data);
  }),
  readAsStringAsync: jest.fn(async (path: string) => mockFiles.get(path)),
  deleteAsync: jest.fn(async (path: string) => {
    mockFiles.delete(path);
  }),
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
  useSegments: () => ['recording', 'review'],
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
jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  registerPushToken: jest.fn(async () => true),
  unregisterPushToken: jest.fn(async () => true),
}));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides()
);
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  holdsRecordingStartingIn: jest.fn(() => false),
  holdRecordingsOfOtherAthletes: jest.fn(async () => undefined),
}));

const mockHero: { props: Record<string, unknown> | null } = { props: null };
jest.mock('@/features/recording/components/ReviewMapHero', () => ({
  ReviewMapHero: (props: Record<string, unknown>) => {
    mockHero.props = props;
    return null;
  },
}));
jest.mock('@/features/recording/hooks/useReviewSave', () => ({
  useReviewSave: () => ({
    isUploading: false,
    leaving: false,
    errorMessage: null,
    handleSave: jest.fn(),
    canRetry: false,
  }),
}));
jest.mock('@/shared/app/sheetRequest', () => ({
  useSheetOpener: () => async () => ({ kind: 'selected', value: 'Run' }),
}));

const START = 1_700_000_000_000;
const STREAMS: RecordingStreams = {
  time: [0, 1, 2, 3, 4],
  latlng: [
    [45.0, 10.0],
    [45.001, 10.001],
    [45.002, 10.002],
    [45.003, 10.003],
    [45.004, 10.004],
  ],
  altitude: [100, 101, 102, 103, 104],
  heartrate: [120, 130, 140, 150, 160],
  power: [0, 0, 0, 0, 0],
  cadence: [0, 0, 0, 0, 0],
  speed: [8, 8, 8, 8, 8],
  distance: [0, 8, 16, 24, 32],
};

function signIn() {
  useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true, authMethod: 'oauth' });
}

async function editReview() {
  const view = await render(inStack(<ReviewScreen />));
  await fireEvent.changeText(view.getByTestId('review-activity-name'), 'Hill repeats');
  await fireEvent.changeText(view.getByTestId('review-notes'), 'Legs heavy on the third climb');
  await act(async () => {
    await fireEvent.press(view.getByTestId('review-activity-type'));
  });
  await act(() => {
    (mockHero.props!.onTrimChange as (a: number, b: number) => void)(1, 3);
    (mockHero.props!.onTrimCommit as (a: number, b: number) => void)(1, 3);
  });
  return view;
}

function expectEdits(view: Awaited<ReturnType<typeof render>>) {
  expect(view.getByTestId('review-activity-name').props.value).toBe('Hill repeats');
  expect(view.getByTestId('review-notes').props.value).toBe('Legs heavy on the third climb');
  expect(view.getByText('activityTypes.Run')).toBeTruthy();
  expect(mockHero.props).toEqual(
    expect.objectContaining({ trimStart: 1, trimEnd: 3, mapTrimStart: 1, mapTrimEnd: 3 })
  );
}

beforeEach(() => {
  jest.useRealTimers();
  mockFiles.clear();
  mockHero.props = null;
  signIn();
  useRecordingStore.getState().reset();
  useRecordingStore.setState({
    status: 'stopped',
    athleteId: 'i1',
    activityType: 'Ride',
    mode: 'gps',
    startTime: START,
    stopTime: START + 5_000,
    pausedDuration: 0,
    pauseIntervals: [],
    streams: STREAMS,
    laps: [],
    savedToLibrary: false,
  });
});

it('reopens review with the edits a forced sign-out interrupted', async () => {
  const first = await editReview();

  await act(async () => {
    await useAuthStore.getState().handleSessionExpired();
  });
  expect(useRecordingStore.getState().status).toBe('idle');
  await first.unmount();

  signIn();
  let route: string | null = null;
  await act(async () => {
    route = await resumeHeldRecordingForAthlete('i1');
  });
  expect(route).toBe('/recording/review');

  expectEdits(await render(inStack(<ReviewScreen />)));
});

it('writes the edits to the backup while review is open, so a kill keeps them', async () => {
  jest.useFakeTimers();
  await editReview();
  await act(async () => {
    jest.advanceTimersByTime(5_000);
  });
  jest.useRealTimers();

  const backup = await loadRecordingBackup();
  expect(backup).toEqual(
    expect.objectContaining({
      status: 'stopped',
      review: {
        name: 'Hill repeats',
        notes: 'Legs heavy on the third climb',
        reviewedType: 'Run',
        trimStart: 1,
        trimEnd: 3,
      },
    })
  );
});

it('drops a trim the reopened ride no longer has room for', async () => {
  useRecordingStore.setState({
    review: { name: 'Hill repeats', trimStart: 2, trimEnd: 40 },
  });
  const view = await render(inStack(<ReviewScreen />));
  expect(view.getByTestId('review-activity-name').props.value).toBe('Hill repeats');
  expect(mockHero.props).toEqual(expect.objectContaining({ trimStart: 0, trimEnd: 4 }));
});
