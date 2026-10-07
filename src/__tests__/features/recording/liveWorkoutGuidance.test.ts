/**
 * The planned ride or run a recording follows lives in the recording store, on
 * the moving clock and the recorded distance, and travels through the crash
 * backup with the ride.
 */
import { expandPlan } from '@/features/recording/lib/planFollow';
import { restoreRecordingBackup } from '@/features/recording/lib/restoreRecordingBackup';
import {
  buildRecordingBackup,
  loadRecordingBackup,
  saveRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import { useRecordingStore, workoutAt } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { RecordingBackup } from '@/types';

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

const T0 = 1_800_000_000_000;
const SEC = 1000;
const store = () => useRecordingStore.getState();

function fixAt(seconds: number, metresNorth: number) {
  // One degree of latitude is about 111.2 km.
  return {
    latitude: 46 + metresNorth / 111_195,
    longitude: 7,
    altitude: 500,
    accuracy: 5,
    speed: 3,
    heading: 0,
    timestamp: T0 + seconds * SEC,
  };
}

const plan = {
  name: 'Kilometre repeats',
  lines: expandPlan([
    { text: 'Warm up', duration: 120 },
    { text: 'Kilometre', distance: 1000, duration: 300 },
    { text: 'Jog', duration: 60 },
  ]),
};

function start(type: 'Run' | 'VirtualRun', mode: 'gps' | 'indoor', withPlan: typeof plan | null) {
  store().startRecording(type, mode, 7);
  store().followWorkout(withPlan);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  mockFiles.clear();
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
  store().reset();
});

afterEach(() => {
  store().reset();
  jest.useRealTimers();
});

it('counts a timed step down on active time, with a pause left out', () => {
  start('Run', 'gps', plan);
  jest.setSystemTime(T0 + 30 * SEC);
  store().pauseRecording();
  jest.setSystemTime(T0 + 90 * SEC);
  expect(workoutAt(store(), Date.now())?.remainingSeconds).toBe(90);
  store().resumeRecording();
  expect(workoutAt(store(), Date.now())?.remainingSeconds).toBe(90);
  jest.setSystemTime(T0 + 100 * SEC);
  expect(workoutAt(store(), Date.now())?.remainingSeconds).toBe(80);
});

it('advances a distance step on the distance recorded since it began', () => {
  start('Run', 'gps', plan);
  store().addGpsPoint(fixAt(0, 0));
  // The warm-up runs out at 120 s and the kilometre starts from 300 m.
  store().addGpsPoint(fixAt(121, 300));
  expect(store().workout?.follow.index).toBe(1);
  expect(store().workout?.follow.lineStartDistance).toBeCloseTo(300, 0);
  // 300 s into the kilometre is its estimate, and 800 m is not a kilometre.
  store().addGpsPoint(fixAt(420, 1100));
  expect(store().workout?.follow.index).toBe(1);
  jest.setSystemTime(T0 + 420 * SEC);
  expect(workoutAt(store(), Date.now())?.remainingMetres).toBeCloseTo(200, 0);
  store().addGpsPoint(fixAt(470, 1305));
  expect(store().workout?.follow.index).toBe(2);
});

it('lets the athlete advance an indoor distance step that has no distance to finish it', () => {
  start('VirtualRun', 'indoor', plan);
  jest.setSystemTime(T0 + 3600 * SEC);
  store().addIndoorSample();
  expect(store().workout?.follow.index).toBe(1);
  expect(workoutAt(store(), Date.now())?.remainingMetres).toBeNull();
  store().advanceWorkout();
  expect(store().workout?.follow.index).toBe(2);
});

it('keeps recording once the last step is done', () => {
  start('Run', 'gps', plan);
  store().advanceWorkout();
  store().advanceWorkout();
  store().advanceWorkout();
  expect(store().workout?.follow.finishedAt).not.toBeNull();
  expect(store().status).toBe('recording');
  expect(store().pairedEventId).toBe(7);
});

it('records with no guidance when there is no plan, and keeps the pairing', () => {
  start('Run', 'gps', null);
  expect(store().workout).toBeNull();
  expect(store().pairedEventId).toBe(7);
  store().advanceWorkout();
  expect(store().status).toBe('recording');
});

it('restores the same plan, step and progress from the backup', async () => {
  start('Run', 'gps', plan);
  store().addGpsPoint(fixAt(0, 0));
  store().addGpsPoint(fixAt(121, 300));
  jest.setSystemTime(T0 + 150 * SEC);
  const backup = buildRecordingBackup(store());
  expect(backup).not.toBeNull();
  await saveRecordingBackup(backup!);
  const saved = store().workout;
  store().reset();

  const loaded = await loadRecordingBackup();
  jest.setSystemTime(T0 + 400 * SEC);
  restoreRecordingBackup(loaded!);

  expect(store().workout).toEqual(saved);
  // The time the app was away is credited as a pause, so the moving clock and
  // the step's progress resume where the backup left them.
  const view = workoutAt(store(), Date.now());
  expect(view?.follow.index).toBe(1);
  expect(view?.remainingMetres).toBeCloseTo(1000, 0);
});

it('restores an old backup with no guidance, and drops a malformed plan rather than the ride', async () => {
  start('Run', 'gps', plan);
  store().addGpsPoint(fixAt(0, 0));
  const backup = buildRecordingBackup(store()) as RecordingBackup & { workout?: unknown };
  store().reset();

  const { workout: _, ...old } = backup;
  restoreRecordingBackup(old as RecordingBackup);
  expect(store().status).toBe('paused');
  expect(store().workout).toBeNull();
  expect(store().pairedEventId).toBe(7);
  store().reset();

  for (const broken of [
    { name: 'x', follow: { lines: 'no', index: 0 } },
    { name: 'x', follow: { ...backup.workout!.follow, index: 99 } },
    { name: 'x', follow: { ...backup.workout!.follow, lines: [{ kind: 'work', text: 1 }] } },
    'nonsense',
  ]) {
    restoreRecordingBackup({ ...old, workout: broken } as unknown as RecordingBackup);
    expect(store().status).toBe('paused');
    expect(store().workout).toBeNull();
    expect(store().streams.time).toHaveLength(1);
    store().reset();
  }
});
