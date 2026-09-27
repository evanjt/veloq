import * as FileSystem from 'expo-file-system/legacy';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';
import { restoreRecordingBackup } from '@/features/recording/lib/restoreRecordingBackup';
import {
  loadRecordingBackup,
  saveRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import type { RecordingBackup } from '@/types';

const mockFiles = new Map<string, string>();
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => {
    mockFiles.set(path, data);
  }),
  readAsStringAsync: jest.fn(async (path: string) => mockFiles.get(path)),
  deleteAsync: jest.fn(async (path: string) => {
    mockFiles.delete(path);
  }),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  watchPositionAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

function backup(status: RecordingBackup['status']): RecordingBackup {
  return {
    status,
    activityType: 'Ride',
    mode: 'gps',
    startTime: 1_700_000_000_000,
    stopTime: status === 'stopped' ? 1_700_000_010_000 : null,
    savedAt: 1_700_000_010_000,
    pausedDuration: 2000,
    pauseIntervals: [{ start: 2, end: 4 }],
    pairedEventId: 42,
    laps: [],
    streams: {
      time: [0, 1],
      latlng: [
        [47, 8],
        [47.001, 8],
      ],
      altitude: [450, 452],
      heartrate: [],
      power: [],
      cadence: [],
      speed: [0, 2],
      distance: [0, 100],
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('Resume crash backup', () => {
  let uninstall: () => void;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_020_000);
    jest.clearAllMocks();
    mockFiles.clear();
    useRecordingStore.getState().reset();
    uninstall = installRecordingSession();
  });
  afterEach(() => {
    uninstall();
    jest.useRealTimers();
  });

  it.each(['stopped', 'paused', 'recording'] as const)(
    'preserves %s ride on disk across another kill',
    async (status) => {
      const original = backup(status);
      await saveRecordingBackup(original);
      (FileSystem.writeAsStringAsync as jest.Mock).mockClear();
      const loaded = await loadRecordingBackup();
      expect(loaded).not.toBeNull();
      expect(restoreRecordingBackup(loaded!)).toBe(
        status === 'stopped' ? '/recording/review' : '/recording/Ride'
      );
      await settle();
      for (const [, data] of (FileSystem.writeAsStringAsync as jest.Mock).mock.calls) {
        expect(JSON.parse(data).streams).toEqual(original.streams);
        expect(JSON.parse(data).startTime).toBe(original.startTime);
      }
      expect(useRecordingStore.getState().pairedEventId).toBe(42);
      expect(useRecordingStore.getState().totals.elevationGain).toBe(2);
      uninstall();
      useRecordingStore.getState().reset();
      const second = await loadRecordingBackup();
      expect(second?.streams).toEqual(original.streams);
      expect(second?.startTime).toBe(original.startTime);
      expect(second?.status).toBe(status === 'stopped' ? 'stopped' : 'paused');
      uninstall = installRecordingSession();
      restoreRecordingBackup(second!);
      await settle();
      expect(useRecordingStore.getState().streams).toEqual(original.streams);
      expect(useRecordingStore.getState().startTime).toBe(original.startTime);
    }
  );

  it('restores an empty stopped ride without starting a new backup', async () => {
    const original = backup('stopped');
    for (const key of Object.keys(original.streams) as (keyof RecordingBackup['streams'])[])
      original.streams[key] = [];
    await saveRecordingBackup(original);
    (FileSystem.writeAsStringAsync as jest.Mock).mockClear();
    restoreRecordingBackup(original);
    await settle();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect((await loadRecordingBackup())?.startTime).toBe(original.startTime);
    expect(useRecordingStore.getState().totals.elevationGain).toBe(0);
  });
});
