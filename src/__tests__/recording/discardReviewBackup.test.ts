/**
 * Scenario: an earlier GPS ride is left with an unresolved crash backup, then a
 * manual entry is made and discarded on Review.
 * Expected behaviour: the manual entry never owned a backup, so the earlier
 * ride's backup is still there. A discarded ride clears only its own backup.
 */

import {
  buildRecordingBackup,
  saveRecordingBackup,
  loadRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import { discardReviewedRecording } from '@/features/recording/lib/discardReview';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { RecordingStreams } from '@/features/recording/types';

jest.mock('@/shared/debug/debug', () => ({
  debug: {
    log: () => {},
    warn: () => {},
    error: () => {},
    create: () => ({ log: () => {}, warn: () => {}, error: () => {} }),
  },
}));

jest.mock('@/shared/app/navigation', () => ({ returnTo: jest.fn() }));

const mockFileStore = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: mockFileStore.has(path),
    isDirectory: false,
  })),
  writeAsStringAsync: jest.fn(async (path: string, content: string) => {
    mockFileStore.set(path, content);
  }),
  readAsStringAsync: jest.fn(async (path: string) => {
    if (!mockFileStore.has(path)) throw new Error('ENOENT');
    return mockFileStore.get(path)!;
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!mockFileStore.has(from)) throw new Error('ENOENT');
    mockFileStore.set(to, mockFileStore.get(from)!);
    mockFileStore.delete(from);
  }),
  deleteAsync: jest.fn(async (path: string) => {
    mockFileStore.delete(path);
  }),
}));

const streams: RecordingStreams = {
  time: [0, 1],
  latlng: [
    [47.0, 8.0],
    [47.0001, 8.0001],
  ],
  altitude: [400, 401],
  heartrate: [],
  power: [],
  cadence: [],
  speed: [1, 1.1],
  distance: [0, 10],
};

function earlierRide(athleteId: string, startTime: number) {
  return buildRecordingBackup({
    status: 'recording',
    activityType: 'Ride',
    mode: 'gps',
    athleteId,
    startTime,
    stopTime: null,
    pausedDuration: 0,
    streams,
    laps: [],
    pairedEventId: null,
    _pauseStart: null,
  } as Parameters<typeof buildRecordingBackup>[0])!;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockFileStore.clear();
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'athlete-x' });
});

describe('discardReviewedRecording', () => {
  it('keeps the unresolved backup of an earlier ride when a manual entry is discarded', async () => {
    const backup = earlierRide('athlete-x', 1_000_000);
    expect(await saveRecordingBackup(backup)).toBe(true);

    useRecordingStore.getState().startRecording('Yoga', 'manual');
    const startTime = useRecordingStore.getState().startTime;
    expect(discardReviewedRecording(startTime)).toBe(true);
    await flush();

    const loaded = await loadRecordingBackup('athlete-x');
    expect(loaded?.startTime).toBe(1_000_000);
  });

  it('clears the backup of the ride being discarded', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    const { startTime } = useRecordingStore.getState();
    const backup = { ...earlierRide('athlete-x', startTime!), startTime: startTime! };
    expect(await saveRecordingBackup(backup)).toBe(true);

    expect(discardReviewedRecording(startTime)).toBe(true);
    await flush();

    expect(await loadRecordingBackup('athlete-x')).toBeNull();
  });

  it('keeps a different ride’s backup when a GPS ride with no backup is discarded', async () => {
    expect(await saveRecordingBackup(earlierRide('athlete-x', 1_000_000))).toBe(true);

    useRecordingStore.getState().startRecording('Ride', 'gps');
    const { startTime } = useRecordingStore.getState();
    expect(discardReviewedRecording(startTime)).toBe(true);
    await flush();

    expect((await loadRecordingBackup('athlete-x'))?.startTime).toBe(1_000_000);
  });
});
