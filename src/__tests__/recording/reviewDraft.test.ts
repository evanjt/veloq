/**
 * Scenario: the review edits of a stopped ride live in the recording store and
 * travel in its backup.
 *
 * Expected behaviour: only a stopped, unsaved ride takes edits. Resuming the
 * ride keeps its name and notes and drops the sport and trim chosen against
 * the shorter ride. A live ride's backup carries no edits, and a stored draft
 * with a field of the wrong shape loses that field and keeps the ride.
 */

import * as FileSystem from 'expo-file-system/legacy';

import {
  buildRecordingBackup,
  loadRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import { writeReviewedRideBackup } from '@/features/recording/lib/rideBackup';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';

const mockFiles = new Map<string, string>();
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    mockFiles.set(to, mockFiles.get(from)!);
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

const EDITS = {
  name: 'Canal loop',
  notes: 'Headwind home',
  reviewedType: 'Run' as const,
  trimStart: 1,
  trimEnd: 2,
};

function stoppedRide() {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
}

beforeEach(() => {
  mockFiles.clear();
  useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
  useRecordingStore.getState().reset();
});

describe('the store', () => {
  it('takes edits on a stopped ride and merges them', () => {
    stoppedRide();
    useRecordingStore.getState().editReview({ name: 'Canal loop' });
    useRecordingStore.getState().editReview({ notes: 'Headwind home' });
    expect(useRecordingStore.getState().review).toEqual({
      name: 'Canal loop',
      notes: 'Headwind home',
    });
  });

  it('refuses edits on a live ride and on a saved one', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().editReview({ name: 'Canal loop' });
    expect(useRecordingStore.getState().review).toBeNull();

    useRecordingStore.getState().stopRecording();
    const { athleteId, startTime } = useRecordingStore.getState();
    useRecordingStore.getState().markSavedToLibrary(athleteId!, startTime!);
    useRecordingStore.getState().editReview({ name: 'Canal loop' });
    expect(useRecordingStore.getState().review).toBeNull();
  });

  it('keeps the name and notes when the ride resumes, and drops the sport and trim', () => {
    stoppedRide();
    useRecordingStore.getState().editReview(EDITS);
    useRecordingStore.getState().reopenStoppedRecording();
    expect(useRecordingStore.getState().review).toEqual({
      name: 'Canal loop',
      notes: 'Headwind home',
    });
  });

  it('starts the next ride with no edits', () => {
    stoppedRide();
    useRecordingStore.getState().editReview(EDITS);
    useRecordingStore.getState().reset();
    expect(useRecordingStore.getState().review).toBeNull();
    stoppedRide();
    expect(useRecordingStore.getState().review).toBeNull();
  });
});

describe('the backup', () => {
  it('carries a stopped ride’s edits and no live ride’s', () => {
    stoppedRide();
    useRecordingStore.getState().editReview(EDITS);
    expect(buildRecordingBackup(useRecordingStore.getState())?.review).toEqual(EDITS);
    expect(
      buildRecordingBackup({ ...useRecordingStore.getState(), status: 'paused' })?.review
    ).toBeUndefined();
  });

  it('is not written back for a ride the library holds', async () => {
    stoppedRide();
    useRecordingStore.getState().editReview(EDITS);
    const { athleteId, startTime } = useRecordingStore.getState();
    useRecordingStore.getState().markSavedToLibrary(athleteId!, startTime!);
    expect(await writeReviewedRideBackup()).toBe(false);
    expect(await loadRecordingBackup()).toBeNull();
  });

  it('drops a malformed field and keeps the ride and the rest', async () => {
    stoppedRide();
    useRecordingStore.getState().editReview(EDITS);
    await writeReviewedRideBackup();
    const path = [...mockFiles.keys()][0]!;
    const stored = JSON.parse(mockFiles.get(path)!);
    stored.review = {
      name: 42,
      notes: 'Headwind home',
      reviewedType: 'Unicycle',
      trimStart: 3,
      trimEnd: 1,
    };
    await FileSystem.writeAsStringAsync(path, JSON.stringify(stored));

    const read = await loadRecordingBackup();
    expect(read?.status).toBe('stopped');
    expect(read?.review).toEqual({ notes: 'Headwind home' });
  });
});
