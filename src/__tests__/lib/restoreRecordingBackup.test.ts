import * as FileSystem from 'expo-file-system/legacy';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import {
  holdRecordingOnSignOut,
  resumeHeldRecordingForAthlete,
} from '@/features/recording/lib/holdRecordingOnSignOut';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';
import {
  restoreRecordingBackup,
  resumeRecordingBackup,
} from '@/features/recording/lib/restoreRecordingBackup';
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
    useAuthStore.setState({ athleteId: null, isAuthenticated: false });
    uninstall = installRecordingSession();
  });

  it('keeps streams and laps for the same athlete across sign-out and another sign-in', async () => {
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
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
    useRecordingStore.getState().addLap();
    const streams = useRecordingStore.getState().streams;
    const laps = useRecordingStore.getState().laps;
    await holdRecordingOnSignOut('i1');
    expect(useRecordingStore.getState().status).toBe('idle');

    useAuthStore.setState({ athleteId: 'i2', isAuthenticated: true });
    expect(await resumeHeldRecordingForAthlete('i2')).toBeNull();
    expect(useRecordingStore.getState().status).toBe('idle');
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
    expect(await resumeHeldRecordingForAthlete('i1')).toBe('/recording/review');
    expect(useRecordingStore.getState().status).toBe('stopped');
    expect(useRecordingStore.getState().streams).toEqual(streams);
    expect(useRecordingStore.getState().laps).toEqual(laps);
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

  it('resumes the backup into an idle store and names the screen', async () => {
    await saveRecordingBackup(backup('stopped'));
    expect(await resumeRecordingBackup()).toBe('/recording/review');
    expect(useRecordingStore.getState().status).toBe('stopped');
  });

  describe('the pause reason on the prompt path', () => {
    const SIGNED_IN = 'i1';
    beforeEach(() => {
      useRecordingLiveStore.getState().reset();
      useRecordingPreferences.setState({
        autoPauseEnabled: true,
        autoPauseThresholds: { cycling: 3.6 },
        autoPauseDurationMs: 5000,
      });
      useAuthStore.setState({ athleteId: SIGNED_IN, isAuthenticated: true });
    });

    async function resumeSaved(overrides: Partial<RecordingBackup>) {
      await saveRecordingBackup({ ...backup('paused'), athleteId: SIGNED_IN, ...overrides });
      await resumeRecordingBackup();
      await settle();
    }

    // Three fixes a second apart, 10 m north each, well above the resume speed.
    function rideOff() {
      const base = Date.now();
      for (let s = 0; s < 3; s++) {
        useRecordingStore.getState().setRawLocationFix({
          latitude: 47.5 + (s * 10) / 111_320,
          longitude: 8.5,
          altitude: 400,
          accuracy: 5,
          speed: null,
          heading: null,
          timestamp: base + s * 1000,
        });
      }
    }

    it('keeps a restored auto-pause auto-paused so the ride resumes when the rider sets off', async () => {
      await resumeSaved({ autoPaused: true });
      expect(useRecordingStore.getState().status).toBe('paused');
      expect(useRecordingLiveStore.getState().autoPaused).toBe(true);

      rideOff();

      expect(useRecordingStore.getState().status).toBe('recording');
      expect(useRecordingLiveStore.getState().autoPaused).toBe(false);
    });

    it('leaves a ride paused by hand paused when the rider sets off', async () => {
      await resumeSaved({});
      expect(useRecordingLiveStore.getState().autoPaused).toBe(false);

      rideOff();

      expect(useRecordingStore.getState().status).toBe('paused');
    });

    it('brings a ride saved as recording back paused by hand', async () => {
      await resumeSaved({ status: 'recording', autoPaused: false });
      expect(useRecordingLiveStore.getState().autoPaused).toBe(false);

      rideOff();

      expect(useRecordingStore.getState().status).toBe('paused');
    });

    it('never sets the reason on a stopped ride', async () => {
      await resumeSaved({ ...backup('stopped'), autoPaused: true });
      expect(useRecordingStore.getState().status).toBe('stopped');
      expect(useRecordingLiveStore.getState().autoPaused).toBe(false);
    });
  });

  it("does not restore one athlete's ride to another who signs in while it is read", async () => {
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
    await saveRecordingBackup({ ...backup('stopped'), athleteId: 'i1' });
    const load = (FileSystem.readAsStringAsync as jest.Mock).getMockImplementation()!;
    (FileSystem.readAsStringAsync as jest.Mock).mockImplementationOnce(async (path: string) => {
      useAuthStore.setState({ athleteId: 'i2', isAuthenticated: true });
      return load(path);
    });

    expect(await resumeRecordingBackup()).toBeNull();
    expect(useRecordingStore.getState().status).toBe('idle');
    expect(useRecordingStore.getState().athleteId).toBeNull();
  });

  it('leaves a session that started while the backup was loading alone', async () => {
    await saveRecordingBackup(backup('stopped'));
    const load = (FileSystem.readAsStringAsync as jest.Mock).getMockImplementation()!;
    (FileSystem.readAsStringAsync as jest.Mock).mockImplementationOnce(async (path: string) => {
      useRecordingStore.getState().startRecording('Run', 'gps');
      return load(path);
    });

    expect(await resumeRecordingBackup()).toBeNull();
    const state = useRecordingStore.getState();
    expect(state.status).toBe('recording');
    expect(state.activityType).toBe('Run');
  });

  it('leaves the athlete where they are on a live ride of their own and sends a stopped one to review', async () => {
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
    useRecordingStore.getState().startRecording('Ride', 'gps');
    expect(await resumeHeldRecordingForAthlete('i1')).toBeNull();
    useRecordingStore.getState().pauseRecording();
    expect(await resumeHeldRecordingForAthlete('i1')).toBeNull();
    useRecordingStore.getState().stopRecording();
    expect(await resumeHeldRecordingForAthlete('i1')).toBe('/recording/review');
    expect(useRecordingStore.getState().status).toBe('stopped');
  });
});
