/**
 * Scenario: My Recordings opens from a notification tap, so its first read can
 * reach the engine before the root layout has opened it, or reach an engine
 * whose read throws.
 *
 * Expected behaviour: every load ends loaded, empty or failed. A read that
 * throws ends the load with the error kept for the screen to show beside a
 * Retry. An engine not open yet is a load still under way, and the list is
 * read the moment it opens.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useRecordingLibrary } from '@/features/recording/hooks/useRecordingLibrary';
import { listVisibleRecordings } from '@/features/recording/lib/storage/recordingLibrary';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { getEngine } from '@/shared/native/engine';
import type { RecordingLibraryEntry } from '@/types';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: (effect: () => void) => require('react').useEffect(() => effect(), [effect]),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadRecordingNow: jest.fn(),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  listVisibleRecordings: jest.fn(),
  getVisibleRecording: jest.fn(),
  deleteRecording: jest.fn(async () => {}),
  onRecordingsChanged: jest.fn(() => () => {}),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockList = listVisibleRecordings as jest.Mock;
const mockGetEngine = getEngine as jest.Mock;
const OPEN = { id: 'open-handle' };

const HILL_REPEATS: RecordingLibraryEntry = {
  id: 'rec-hill',
  kind: 'fit',
  fitPath: 'file:///recordings/rec-hill.fit',
  activityType: 'Ride',
  name: 'Hill repeats',
  startTime: Date.parse('2026-08-02T05:00:00Z'),
  durationSeconds: 2400,
  distanceMeters: 16_000,
  createdAt: Date.parse('2026-08-02T06:00:00Z'),
  uploadStatus: 'localOnly',
  retryCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  useEngineStatus.setState({ initFailed: false, readyNonce: 0 });
  mockGetEngine.mockReturnValue(OPEN);
});

describe('loading My Recordings', () => {
  it('ends the load with the error kept when the list read throws', async () => {
    const failure = { tag: 'Database', message: 'disk I/O error' };
    mockList.mockRejectedValue(failure);

    const { result } = renderHook(() => useRecordingLibrary());
    await act(async () => {});

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(failure);
    expect(result.current.entries).toEqual([]);
  });

  it('clears the error when a retry reads the list', async () => {
    mockList.mockRejectedValueOnce(new Error('busy')).mockResolvedValue([HILL_REPEATS]);

    const { result } = renderHook(() => useRecordingLibrary());
    await act(async () => {});
    expect(result.current.error).toBeTruthy();

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.entries.map((e) => e.id)).toEqual(['rec-hill']);
  });

  it('keeps loading while the engine is not open, then reads the list when it opens', async () => {
    mockGetEngine.mockReturnValue(null);
    mockList.mockRejectedValue(new Error('Engine not initialised'));

    const { result } = renderHook(() => useRecordingLibrary());
    await act(async () => {});
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();

    mockGetEngine.mockReturnValue(OPEN);
    mockList.mockResolvedValue([HILL_REPEATS]);
    await act(async () => {
      useEngineStatus.getState().markEngineReady();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.entries.map((e) => e.id)).toEqual(['rec-hill']);
  });

  it('reads the list again when the engine handle is replaced', async () => {
    mockList.mockResolvedValue([]);
    const { result } = renderHook(() => useRecordingLibrary());
    await act(async () => {});
    expect(mockList).toHaveBeenCalledTimes(1);

    mockGetEngine.mockReturnValue({ id: 'reopened-handle' });
    mockList.mockResolvedValue([HILL_REPEATS]);
    await act(async () => {
      useEngineStatus.getState().markEngineReady();
    });

    expect(mockList).toHaveBeenCalledTimes(2);
    expect(result.current.entries.map((e) => e.id)).toEqual(['rec-hill']);
  });

  it('ends the load as failed when the engine failed to open', async () => {
    mockGetEngine.mockReturnValue(null);
    useEngineStatus.setState({ initFailed: true });
    const failure = { tag: 'NotInitialized' };
    mockList.mockRejectedValue(failure);

    const { result } = renderHook(() => useRecordingLibrary());
    await act(async () => {});

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(failure);
  });
});
