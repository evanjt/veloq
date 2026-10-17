/**
 * Scenario: My Recordings, or one recording opened from a notification tap,
 * meets an engine whose read throws, or a recording that is not there.
 *
 * Expected behaviour: neither screen stays on its spinner. A read that throws
 * shows the failure with a Retry that reads again, a missing recording shows
 * the empty state with a way back, and every state sits under the native
 * header without its own top inset, so the content does not jump when the load
 * settles.
 */

import React from 'react';
import { ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HeaderShownContext } from 'expo-router/react-navigation';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import RecordingsLibraryScreen from '@/app/recordings/index';
import RecordingDetailScreen from '@/app/recordings/[id]';
import { getVisibleRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { useRecordingLibrary } from '@/features/recording/hooks/useRecordingLibrary';
import type { RecordingLibraryEntry } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'rec-tempo' }),
  router: { back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useScreenSafeAreaEdges: () => ['top', 'bottom', 'left', 'right'],
}));
jest.mock('@/shared/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    Card: jest.requireActual('@/shared/ui/Card').Card,
    ScreenSafeAreaView: jest.requireActual('@/shared/ui/ScreenSafeAreaView').ScreenSafeAreaView,
    useBottomClearance: () => 0,
    useScrollEndInset: () => 0,
    useHeroMapHeight: () => 300,
    screenListInsets: {},
    EmptyState: ({
      title,
      actionLabel,
      onAction,
    }: {
      title: string;
      actionLabel?: string;
      onAction?: () => void;
    }) => (
      <View>
        <Text>{title}</Text>
        {actionLabel ? (
          <Pressable onPress={onAction}>
            <Text>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    ),
    ErrorState: ({ onRetry, testID }: { onRetry: () => void; testID: string }) => (
      <View testID={testID}>
        <Pressable testID={`${testID}-retry`} onPress={onRetry}>
          <Text>common.retry</Text>
        </Pressable>
      </View>
    ),
  };
});
jest.mock('@/features/recording/components/RecordingMap', () => ({
  RecordingMap: () => null,
}));
jest.mock('@/features/recording/components/PermissionUpgradeBanner', () => ({
  PermissionUpgradeBanner: () => null,
}));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides()
);
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  getVisibleRecording: jest.fn(),
  recordingFitExists: jest.fn(async () => true),
}));
jest.mock('@/features/recording/hooks/useRecordingLibrary', () => ({
  ...jest.requireActual('@/features/recording/hooks/useRecordingLibrary'),
  useRecordingLibrary: jest.fn(),
}));
const mockOpenEngine = { id: 'open-handle' };
jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => mockOpenEngine,
  useEngineOpening: () => false,
}));

const mockLibrary = useRecordingLibrary as jest.Mock;
const mockGetVisible = getVisibleRecording as jest.Mock;

const TEMPO: RecordingLibraryEntry = {
  id: 'rec-tempo',
  kind: 'fit',
  fitPath: '/recordings/rec-tempo.fit',
  name: 'Tempo loop',
  activityType: 'Ride',
  startTime: 0,
  createdAt: 0,
  durationSeconds: 1800,
  distanceMeters: 12_000,
  uploadStatus: 'uploaded',
  retryCount: 0,
};

function library(overrides: Partial<ReturnType<typeof useRecordingLibrary>> = {}) {
  return {
    entries: [],
    isLoading: false,
    error: null,
    refresh: jest.fn(async () => {}),
    uploadNow: jest.fn(),
    remove: jest.fn(),
    uploadingId: null,
    ...overrides,
  };
}

/** The recording opened in the stack, which shows its native header. */
function renderDetail() {
  return render(
    <HeaderShownContext.Provider value={true}>
      <RecordingDetailScreen />
    </HeaderShownContext.Provider>
  );
}

function takesTopInset(): boolean {
  return screen.UNSAFE_getByType(SafeAreaView).props.edges.includes('top');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLibrary.mockReturnValue(library());
});

describe('My Recordings', () => {
  it('shows the failure with a Retry that reads the list again, not the spinner', () => {
    const refresh = jest.fn(async () => {});
    mockLibrary.mockReturnValue(library({ error: { tag: 'Database' }, refresh }));

    render(<RecordingsLibraryScreen />);

    expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
    expect(screen.queryByTestId('recordings-list')).toBeNull();
    fireEvent.press(screen.getByTestId('recordings-read-failure-retry'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('draws placeholder rows while the load is under way', () => {
    mockLibrary.mockReturnValue(library({ isLoading: true }));

    render(<RecordingsLibraryScreen />);

    expect(
      screen.getAllByTestId('recording-row-skeleton', { includeHiddenElements: true }).length
    ).toBeGreaterThan(0);
    expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
    expect(screen.queryByTestId('recordings-read-failure')).toBeNull();
  });
});

describe('one recording', () => {
  it('draws the stats card as a placeholder while the read is pending', () => {
    mockGetVisible.mockReturnValue(new Promise(() => {}));

    renderDetail();

    expect(screen.getByTestId('recording-detail-skeleton')).toBeTruthy();
    expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
    expect(takesTopInset()).toBe(false);
  });

  it('shows the failure with a Retry when the read rejects, not the spinner', async () => {
    mockGetVisible.mockRejectedValue({ tag: 'Database', message: 'disk I/O error' });

    renderDetail();

    await screen.findByTestId('recording-detail-read-failure');
    expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
    expect(takesTopInset()).toBe(false);
  });

  it('reads again on Retry and shows the recording', async () => {
    mockGetVisible.mockRejectedValueOnce(new Error('busy')).mockResolvedValue(TEMPO);

    renderDetail();
    fireEvent.press(await screen.findByTestId('recording-detail-read-failure-retry'));

    await screen.findByText('Delete');
    expect(screen.queryByTestId('recording-detail-read-failure')).toBeNull();
    expect(mockGetVisible).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state with Back for a recording that is not there', async () => {
    mockGetVisible.mockResolvedValue(null);

    renderDetail();
    fireEvent.press(await screen.findByText('common.back'));

    expect(screen.getByText('Recording not found')).toBeTruthy();
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(takesTopInset()).toBe(false);
  });

  it('sits under the native header once loaded, as it did while loading', async () => {
    mockGetVisible.mockResolvedValue(TEMPO);

    renderDetail();
    await screen.findByText('Delete');

    expect(takesTopInset()).toBe(false);
  });
});
