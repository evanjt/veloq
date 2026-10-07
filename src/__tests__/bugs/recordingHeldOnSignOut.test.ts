import {
  holdRecordingOnSignOut,
  resumeHeldRecordingForAthlete,
} from '@/features/recording/lib/holdRecordingOnSignOut';
import { saveRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';

const mockLoadBackup = jest.fn(async () => null);
const mockResumeBackup = jest.fn(async () => '/recording/review');
const mockRestoreBackup = jest.fn((_backup: unknown) => '/recording/review');
const mockLibraryHoldsRide = jest.fn((_backup: unknown) => false);

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingBackup'),
  saveRecordingBackup: jest.fn(async () => true),
  loadRecordingBackup: () => mockLoadBackup(),
}));
jest.mock('@/features/recording/lib/restoreRecordingBackup', () => ({
  resumeRecordingBackup: () => mockResumeBackup(),
  restoreRecordingBackup: (backup: unknown) => mockRestoreBackup(backup),
  libraryHoldsRide: (backup: unknown) => mockLibraryHoldsRide(backup),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadBackup.mockResolvedValue(null);
  mockResumeBackup.mockResolvedValue('/recording/review');
  mockLibraryHoldsRide.mockReturnValue(false);
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
});

it('stops and holds a live ride for the outgoing athlete without opening review', async () => {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().addGpsPoint({
    latitude: 47,
    longitude: 8,
    altitude: 400,
    accuracy: 5,
    speed: 1,
    heading: 0,
    timestamp: Date.now(),
  });
  await holdRecordingOnSignOut('i1');

  expect(saveRecordingBackup).toHaveBeenCalledWith(
    expect.objectContaining({
      athleteId: 'i1',
      status: 'stopped',
      streams: expect.objectContaining({ latlng: [[47, 8]] }),
    })
  );
  expect(useRecordingStore.getState().status).toBe('idle');
});

it('keeps a stopped ride in memory when its backup cannot be written', async () => {
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  useRecordingStore.getState().startRecording('Ride', 'gps');
  await holdRecordingOnSignOut('i1');
  expect(useRecordingStore.getState().status).toBe('stopped');
  expect(useRecordingStore.getState().athleteId).toBe('i1');
});

it('does not turn a manual entry into a stopped ride on sign-out', async () => {
  useRecordingStore.getState().startRecording('Yoga', 'manual');
  await holdRecordingOnSignOut('i1');
  expect(saveRecordingBackup).not.toHaveBeenCalled();
  expect(useRecordingStore.getState().status).toBe('idle');
});

it('keeps a failed-write ride from a different athlete and reopens it for its owner', async () => {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  await holdRecordingOnSignOut('i1');
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  expect(await resumeHeldRecordingForAthlete('i2')).toBeNull();
  expect(useRecordingStore.getState().status).toBe('idle');
  expect(await resumeHeldRecordingForAthlete('i1')).toBe('/recording/review');
  expect(mockRestoreBackup).toHaveBeenCalledWith(expect.objectContaining({ athleteId: 'i1' }));
});

it('opens a stopped backup for its athlete after relaunch', async () => {
  mockLoadBackup.mockResolvedValueOnce({ athleteId: 'i1', status: 'stopped' } as never);
  expect(await resumeHeldRecordingForAthlete('i1')).toBe('/recording/review');
  expect(mockResumeBackup).toHaveBeenCalledTimes(1);
});

it('opens the new athlete’s ride while retaining an unwritable prior ride in memory', async () => {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  await holdRecordingOnSignOut('i1');
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  mockLoadBackup.mockResolvedValueOnce({ athleteId: 'i2', status: 'stopped' } as never);
  expect(await resumeHeldRecordingForAthlete('i2')).toBe('/recording/review');
  expect(useRecordingStore.getState().status).toBe('idle');
  expect(await resumeHeldRecordingForAthlete('i1')).toBe('/recording/review');
  expect(mockRestoreBackup).toHaveBeenCalledWith(expect.objectContaining({ athleteId: 'i1' }));
});

it('drops a ride held in memory that the library holds, and still opens a backup of another', async () => {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  await holdRecordingOnSignOut('i1');
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  expect(await resumeHeldRecordingForAthlete('i2')).toBeNull();

  mockLibraryHoldsRide.mockReturnValue(true);
  mockLoadBackup.mockResolvedValueOnce({ athleteId: 'i1', status: 'stopped' } as never);
  expect(await resumeHeldRecordingForAthlete('i1')).toBe('/recording/review');
  expect(mockRestoreBackup).not.toHaveBeenCalled();
  expect(mockResumeBackup).toHaveBeenCalledTimes(1);

  mockLibraryHoldsRide.mockReturnValue(false);
  expect(await resumeHeldRecordingForAthlete('i1')).toBeNull();
  expect(mockRestoreBackup).not.toHaveBeenCalled();
});

it('does not reset a new ride after a slow sign-out backup finishes', async () => {
  let finishWrite!: (saved: boolean) => void;
  (saveRecordingBackup as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      })
  );
  useRecordingStore.getState().startRecording('Ride', 'gps');
  const pending = holdRecordingOnSignOut('i1');
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'i2', isAuthenticated: true });
  useRecordingStore.getState().startRecording('Run', 'gps');
  finishWrite(true);
  await pending;
  expect(useRecordingStore.getState().activityType).toBe('Run');
});

it('does not reset a new ride after a slow cross-athlete hold finishes', async () => {
  let finishWrite!: (saved: boolean) => void;
  (saveRecordingBackup as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      })
  );
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  const pending = resumeHeldRecordingForAthlete('i2');
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'i2', isAuthenticated: true });
  useRecordingStore.getState().startRecording('Run', 'gps');
  finishWrite(true);
  await pending;
  expect(useRecordingStore.getState().activityType).toBe('Run');
});
