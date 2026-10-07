/**
 * Scenario: a ride auto-pauses at a traffic light, then the rider sets off again.
 *
 * Expected behaviour: the detector keeps seeing speed while paused, because raw
 * location fixes are published whether or not the point is recorded, so the
 * resume branch fires. Driving it from `streams.speed` could never resume: the
 * stream stops growing the moment `addGpsPoint` starts refusing. The session
 * owns the detector, so this holds with no recording screen mounted.
 */

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import * as Location from 'expo-location';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';
import {
  buildAutoPauseDetector,
  resetAutoPause,
  resumeRecordingManually,
} from '@/features/recording/lib/manualPause';
import { applyRecordingNotificationAction } from '@/features/recording/lib/recordingNotification';
import { buildRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { pausedSecondsBetween } from '@/features/recording/lib/pausedTime';

const mockControlListeners: ((event: { action: string }) => void)[] = [];

// The Live Activity's bridge, so its lock-screen controls can be pressed.
jest.mock('@/features/recording/lib/liveActivity/bridge', () => ({
  isLiveActivitySupported: () => true,
  startNativeLiveActivity: () => undefined,
  updateNativeLiveActivity: () => undefined,
  endNativeLiveActivity: () => undefined,
  endAllNativeLiveActivities: () => undefined,
  onLiveActivityControl: (listener: (event: { action: string }) => void) => {
    mockControlListeners.push(listener);
    return () => {
      const at = mockControlListeners.indexOf(listener);
      if (at >= 0) mockControlListeners.splice(at, 1);
    };
  },
}));

function pressLiveActivity(action: string): void {
  for (const listener of [...mockControlListeners]) listener({ action });
}

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  buildRecordingBackup: jest.fn(() => null),
  saveRecordingBackup: jest.fn(),
  clearRecordingBackup: jest.fn(),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
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

const FIX_EPOCH = 1_700_000_000_000;

function fixAt(secondsIn: number, metresNorth: number) {
  return {
    latitude: 47.5 + metresNorth / 111_320,
    longitude: 8.5,
    altitude: 400,
    accuracy: 5,
    speed: null,
    heading: null,
    timestamp: FIX_EPOCH + secondsIn * 1000,
  };
}

// One fix per second, moving north from a fixed origin at the given speed.
function pushFix(secondsIn: number, metresNorth: number) {
  useRecordingStore.getState().setRawLocationFix(fixAt(secondsIn, metresNorth));
}

// A fix handled the way a location batch handles it: published raw, then
// recorded if auto-pause left the ride recording.
function recordFix(secondsIn: number, metresNorth: number) {
  const fix = fixAt(secondsIn, metresNorth);
  useRecordingStore.getState().setRawLocationFix(fix);
  if (useRecordingStore.getState().status === 'recording') {
    useRecordingStore.getState().addGpsPoint(fix);
  }
}

describe('recordingSession auto-pause', () => {
  let uninstall: () => void;

  beforeEach(() => {
    useRecordingStore.getState().reset();
    useRecordingLiveStore.getState().reset();
    useRecordingPreferences.setState({
      autoPauseEnabled: true,
      autoPauseThresholds: { cycling: 3.6 }, // 1 m/s
      autoPauseDurationMs: 5000,
    });
    uninstall = installRecordingSession();
  });

  afterEach(() => uninstall());

  it('pauses after the stationary duration and resumes when moving again', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');

    let metres = 0;
    for (let second = 0; second <= 3; second++) pushFix(second, (metres += 10));
    expect(useRecordingLiveStore.getState().autoPaused).toBe(false);

    // Stationary: same position, so derived speed is 0.
    for (let second = 4; second <= 10; second++) pushFix(second, metres);
    expect(useRecordingStore.getState().status).toBe('paused');
    expect(useRecordingLiveStore.getState().autoPaused).toBe(true);

    // Rolling again, well above the resume hysteresis.
    for (let second = 11; second <= 13; second++) pushFix(second, (metres += 10));

    expect(useRecordingStore.getState().status).toBe('recording');
    expect(useRecordingLiveStore.getState().autoPaused).toBe(false);
  });

  it('publishes raw speed while paused, when addGpsPoint refuses the point', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    pushFix(0, 0);
    useRecordingStore.getState().pauseRecording();

    pushFix(1, 10);

    expect(useRecordingStore.getState().streams.speed).toHaveLength(0);
    expect(useRecordingStore.getState().rawSpeed?.value).toBeCloseTo(10, 1);
  });

  it('does not auto-resume a pause the rider took', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    pushFix(0, 0);
    useRecordingStore.getState().pauseRecording();
    resetAutoPause();

    for (let second = 1; second <= 5; second++) pushFix(second, second * 10);

    expect(useRecordingStore.getState().status).toBe('paused');
  });

  it('leaves the session alone once it has stopped', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    let metres = 0;
    for (let second = 0; second <= 3; second++) pushFix(second, (metres += 10));
    useRecordingStore.getState().stopRecording();

    for (let second = 4; second <= 12; second++) pushFix(second, metres);

    expect(useRecordingStore.getState().status).toBe('stopped');
  });

  it('writes the backup at an auto-pause with the pause reason', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    let metres = 0;
    for (let second = 0; second <= 3; second++) pushFix(second, (metres += 10));
    (buildRecordingBackup as jest.Mock).mockClear();
    for (let second = 4; second <= 10; second++) pushFix(second, metres);

    const written = (buildRecordingBackup as jest.Mock).mock.calls.map(([state]) => state);
    expect(written.at(-1)).toMatchObject({ status: 'paused', autoPaused: true });
  });

  it('still resumes an auto-pause after a preference changes mid-stop', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    let metres = 0;
    for (let second = 0; second <= 3; second++) pushFix(second, (metres += 10));
    for (let second = 4; second <= 10; second++) pushFix(second, metres);
    expect(useRecordingLiveStore.getState().autoPaused).toBe(true);

    useRecordingPreferences.setState({ autoPauseDurationMs: 4000 });
    for (let second = 11; second <= 13; second++) pushFix(second, (metres += 10));

    expect(useRecordingStore.getState().status).toBe('recording');
    expect(useRecordingLiveStore.getState().autoPaused).toBe(false);
  });

  it('hands an auto-pause to the rider when auto-pause is turned off, and Resume ends it', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    let metres = 0;
    for (let second = 0; second <= 3; second++) pushFix(second, (metres += 10));
    for (let second = 4; second <= 10; second++) pushFix(second, metres);
    expect(useRecordingLiveStore.getState().autoPaused).toBe(true);

    useRecordingPreferences.setState({ autoPauseEnabled: false });

    expect(useRecordingLiveStore.getState().autoPaused).toBe(false);
    expect(useRecordingStore.getState().status).toBe('paused');

    resumeRecordingManually();
    recordFix(11, (metres += 10));
    expect(useRecordingStore.getState().status).toBe('recording');
    expect(useRecordingStore.getState().streams.time.length).toBeGreaterThan(0);
  });

  it('resumes a ride the session starts on while auto-paused', () => {
    uninstall();
    useRecordingStore.setState({
      activityType: 'Ride',
      mode: 'gps',
      status: 'paused',
      startTime: 1_700_000_000_000,
      _pauseStart: 1_700_000_000_000,
    });
    useRecordingLiveStore.getState().setAutoPaused(true);
    uninstall = installRecordingSession();

    let metres = 0;
    for (let second = 1; second <= 3; second++) pushFix(second, (metres += 10));

    expect(useRecordingStore.getState().status).toBe('recording');
    expect(useRecordingLiveStore.getState().autoPaused).toBe(false);
  });

  describe.each([
    ['the notification', (action: 'pause' | 'resume') => applyRecordingNotificationAction(action)],
    ['the Live Activity', async (action: 'pause' | 'resume') => pressLiveActivity(action)],
  ])('pause and resume from %s', (_surface, press) => {
    function autoPauseAtALight(): number {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      let metres = 0;
      for (let second = 0; second <= 3; second++) pushFix(second, (metres += 10));
      for (let second = 4; second <= 10; second++) pushFix(second, metres);
      expect(useRecordingStore.getState().status).toBe('paused');
      expect(useRecordingLiveStore.getState().autoPaused).toBe(true);
      return metres;
    }

    it('clears the auto-paused flag on a resume by hand', async () => {
      let metres = autoPauseAtALight();

      await press('resume');
      for (let second = 11; second <= 13; second++) pushFix(second, (metres += 10));

      expect(useRecordingStore.getState().status).toBe('recording');
      expect(useRecordingLiveStore.getState().autoPaused).toBe(false);
    });

    it('never auto-resumes a later pause taken by hand', async () => {
      let metres = autoPauseAtALight();
      await press('resume');
      for (let second = 11; second <= 13; second++) pushFix(second, (metres += 10));

      // A café stop, paused by hand, then standing still long enough to latch
      // the detector and walking around inside above the resume threshold.
      await press('pause');
      for (let second = 14; second <= 20; second++) pushFix(second, metres);
      for (let second = 21; second <= 25; second++) pushFix(second, (metres += 3));

      expect(useRecordingStore.getState().status).toBe('paused');
      expect(useRecordingLiveStore.getState().autoPaused).toBe(false);
    });
  });

  describe('the foreground watch', () => {
    it('records the fix that resumes an auto-pause as the first sample after the pause', async () => {
      let onFix: (location: unknown) => void = () => undefined;
      (Location.watchPositionAsync as jest.Mock).mockImplementation(
        async (_options: unknown, callback: (location: unknown) => void) => {
          onFix = callback;
          return { remove: jest.fn() };
        }
      );
      const now = jest.spyOn(Date, 'now').mockReturnValue(FIX_EPOCH);
      useRecordingStore.getState().startRecording('Ride', 'gps');
      now.mockRestore();
      for (let i = 0; i < 20; i++) await Promise.resolve();

      const deliver = (second: number, metres: number) => {
        const fix = fixAt(second, metres);
        const { timestamp, ...coords } = fix;
        onFix({ coords, timestamp });
      };
      let metres = 0;
      for (let second = 0; second <= 3; second++) deliver(second, (metres += 10));
      for (let second = 4; second <= 10; second++) deliver(second, metres);
      expect(useRecordingStore.getState().status).toBe('paused');
      deliver(11, (metres += 10));
      deliver(12, (metres += 10));

      expect(useRecordingStore.getState().status).toBe('recording');
      const { time } = useRecordingStore.getState().streams;
      expect(time.slice(-2)).toEqual([11, 12]);
    });
  });

  describe('a batch handled after its fixes were taken', () => {
    let now: jest.SpyInstance<number, []>;

    function startAt(secondsIn: number): void {
      now.mockReturnValue(FIX_EPOCH + secondsIn * 1000);
      useRecordingStore.getState().startRecording('Ride', 'gps');
    }

    beforeEach(() => {
      now = jest.spyOn(Date, 'now');
    });

    afterEach(() => now.mockRestore());

    it('stamps the pause and resume at the fixes, not at the time the batch lands', () => {
      startAt(0);
      now.mockReturnValue(FIX_EPOCH + 20_000);

      let metres = 0;
      for (let second = 0; second <= 3; second++) recordFix(second, (metres += 10));
      for (let second = 4; second <= 10; second++) recordFix(second, metres);
      for (let second = 11; second <= 13; second++) recordFix(second, (metres += 10));

      const { status, pauseIntervals, pausedDuration } = useRecordingStore.getState();
      expect(status).toBe('recording');
      expect(pauseIntervals).toEqual([{ start: 4, end: 11 }]);
      expect(pausedDuration).toBe(7000);
    });

    it('keeps ridden points out of a pause a late batch resumes', () => {
      startAt(0);
      let metres = 0;
      for (let second = 0; second <= 3; second++) {
        now.mockReturnValue(FIX_EPOCH + second * 1000);
        recordFix(second, (metres += 10));
      }
      for (let second = 4; second <= 100; second++) {
        now.mockReturnValue(FIX_EPOCH + second * 1000);
        recordFix(second, metres);
      }
      expect(useRecordingStore.getState().status).toBe('paused');

      // Fixes from 101 to 110 s, the rider setting off at 102 s, arrive at 120 s.
      now.mockReturnValue(FIX_EPOCH + 120_000);
      recordFix(101, metres);
      for (let second = 102; second <= 110; second++) recordFix(second, (metres += 10));

      const { pauseIntervals, streams } = useRecordingStore.getState();
      expect(pauseIntervals).toEqual([{ start: 4, end: 102 }]);
      const ridden = streams.time.filter((t) => t >= 102);
      expect(ridden).toEqual([102, 103, 104, 105, 106, 107, 108, 109, 110]);
      for (const t of ridden) expect(pausedSecondsBetween(pauseIntervals, t, t + 1)).toBe(0);
    });

    it('never opens a pause before the previous one closed', () => {
      startAt(0);
      now.mockReturnValue(FIX_EPOCH + 3_000);
      let metres = 0;
      for (let second = 0; second <= 3; second++) recordFix(second, (metres += 10));

      // A pause by hand at 3 s and a resume by hand at 30 s, then a batch whose
      // stop began at 5 s, inside that manual pause, lands at 40 s. The rider moves
      // at 4 s, since a reset ride cannot auto-pause before it has moved again.
      useRecordingStore.getState().pauseRecording();
      now.mockReturnValue(FIX_EPOCH + 30_000);
      resetAutoPause();
      useRecordingStore.getState().resumeRecording();
      now.mockReturnValue(FIX_EPOCH + 40_000);
      pushFix(4, (metres += 10));
      for (let second = 5; second <= 35; second++) pushFix(second, metres);

      const { status, pauseIntervals } = useRecordingStore.getState();
      expect(status).toBe('paused');
      const open = useRecordingStore.getState()._pauseStart;
      expect(pauseIntervals).toEqual([{ start: 3, end: 30 }]);
      expect(open).toBe(FIX_EPOCH + 30_000);
    });

    it('never stamps a pause or resume after the time it is handled', () => {
      startAt(0);
      now.mockReturnValue(FIX_EPOCH + 3_000);
      let metres = 0;
      for (let second = 0; second <= 3; second++) recordFix(second, (metres += 10));
      // A device clock that runs ahead puts fixes in the future.
      now.mockReturnValue(FIX_EPOCH + 5_000);
      for (let second = 4; second <= 10; second++) recordFix(second, metres);
      expect(useRecordingStore.getState()._pauseStart).toBe(FIX_EPOCH + 4_000);
      now.mockReturnValue(FIX_EPOCH + 6_000);
      for (let second = 11; second <= 13; second++) recordFix(second, (metres += 10));

      expect(useRecordingStore.getState().pauseIntervals).toEqual([{ start: 4, end: 6 }]);
    });
  });
});

describe('auto-pause detector defaults', () => {
  it('falls back to the walking default when a stored preference omits it', () => {
    useRecordingStore.getState().reset();
    useRecordingPreferences.setState({
      autoPauseEnabled: true,
      autoPauseThresholds: { cycling: 2 },
      autoPauseDurationMs: 0,
    });
    useRecordingStore.getState().startRecording('Walk', 'gps');
    const detector = buildAutoPauseDetector();
    // 0.3 m/s is 1.08 km/h: above walking's 0.5 km/h, under a 2 km/h fallback.
    detector.update(1, 0);
    const verdicts = [detector.update(0.3, 1000), detector.update(0.3, 2000)];
    expect(verdicts).toEqual([null, null]);
  });

  it.each([
    ['OpenWaterSwim', 0.5],
    ['Snowshoe', 0.42],
    ['Kayaking', 0.5],
  ] as const)('does not pause a %s moving at %s m/s', (type, speed) => {
    useRecordingStore.getState().reset();
    useRecordingPreferences.setState({
      autoPauseEnabled: true,
      autoPauseThresholds: { cycling: 2, running: 1, walking: 0.5 },
      autoPauseDurationMs: 0,
    });
    useRecordingStore.getState().startRecording(type, 'gps');
    const detector = buildAutoPauseDetector();
    detector.update(2, 0);
    const verdicts = [detector.update(speed, 1000), detector.update(speed, 2000)];
    expect(verdicts).toEqual([null, null]);
  });

  it('still pauses a ride moving at 1.5 km/h', () => {
    useRecordingStore.getState().reset();
    useRecordingPreferences.setState({
      autoPauseEnabled: true,
      autoPauseThresholds: { cycling: 2, running: 1, walking: 0.5 },
      autoPauseDurationMs: 0,
    });
    useRecordingStore.getState().startRecording('Ride', 'gps');
    const detector = buildAutoPauseDetector();
    detector.update(5, 0);
    const verdicts = [detector.update(1.5 / 3.6, 1000), detector.update(1.5 / 3.6, 2000)];
    expect(verdicts).toContain('pause');
  });
});
