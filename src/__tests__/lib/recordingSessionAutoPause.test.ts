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
import { installRecordingSession, resetAutoPause } from '@/features/recording/lib/recordingSession';

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  buildRecordingBackup: jest.fn(() => null),
  saveRecordingBackup: jest.fn(),
  clearRecordingBackup: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  watchPositionAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

// One fix per second, moving north from a fixed origin at the given speed.
function pushFix(secondsIn: number, metresNorth: number) {
  useRecordingStore.getState().setRawLocationFix({
    latitude: 47.5 + metresNorth / 111_320,
    longitude: 8.5,
    altitude: 400,
    accuracy: 5,
    speed: null,
    heading: null,
    timestamp: 1_700_000_000_000 + secondsIn * 1000,
  });
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
});
