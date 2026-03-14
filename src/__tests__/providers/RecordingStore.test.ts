import { useRecordingStore, getRecordingStatus } from '@/providers/RecordingStore';
import type { RecordingGpsPoint } from '@/types';

function resetStore() {
  useRecordingStore.getState().reset();
}

describe('RecordingStore', () => {
  beforeEach(() => {
    resetStore();
    jest.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with idle status and empty streams', () => {
      const state = useRecordingStore.getState();
      expect(state.status).toBe('idle');
      expect(state.activityType).toBeNull();
      expect(state.mode).toBeNull();
      expect(state.startTime).toBeNull();
      expect(state.pausedDuration).toBe(0);
      expect(state.streams.time).toEqual([]);
      expect(state.streams.latlng).toEqual([]);
      expect(state.streams.altitude).toEqual([]);
      expect(state.streams.heartrate).toEqual([]);
      expect(state.streams.power).toEqual([]);
      expect(state.streams.cadence).toEqual([]);
      expect(state.streams.speed).toEqual([]);
      expect(state.streams.distance).toEqual([]);
      expect(state.laps).toEqual([]);
      expect(state._pauseStart).toBeNull();
    });
  });

  describe('startRecording()', () => {
    it('transitions to recording with startTime and initialized streams', () => {
      const before = Date.now();
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const after = Date.now();

      const state = useRecordingStore.getState();
      expect(state.status).toBe('recording');
      expect(state.activityType).toBe('Ride');
      expect(state.mode).toBe('gps');
      expect(state.startTime).toBeGreaterThanOrEqual(before);
      expect(state.startTime).toBeLessThanOrEqual(after);
      expect(state.pausedDuration).toBe(0);
      expect(state.streams.time).toEqual([]);
      expect(state.laps).toEqual([]);
      expect(state._pauseStart).toBeNull();
    });

    it('accepts optional pairedEventId', () => {
      useRecordingStore.getState().startRecording('Run', 'gps', 42);
      expect(useRecordingStore.getState().pairedEventId).toBe(42);
    });

    it('sets pairedEventId to null when not provided', () => {
      useRecordingStore.getState().startRecording('Run', 'gps');
      expect(useRecordingStore.getState().pairedEventId).toBeNull();
    });

    it('clears any previous recording data', () => {
      // Start a recording and add data
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const startTime = useRecordingStore.getState().startTime!;
      useRecordingStore.getState().addGpsPoint({
        latitude: 45.0,
        longitude: 10.0,
        altitude: 100,
        accuracy: 5,
        speed: 8,
        heading: 0,
        timestamp: startTime + 1000,
      });

      // Start a new recording
      useRecordingStore.getState().startRecording('Run', 'gps');
      const state = useRecordingStore.getState();
      expect(state.activityType).toBe('Run');
      expect(state.streams.time).toEqual([]);
      expect(state.streams.latlng).toEqual([]);
    });
  });

  describe('pauseRecording()', () => {
    it('transitions from recording to paused with _pauseStart set', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');

      const before = Date.now();
      useRecordingStore.getState().pauseRecording();
      const after = Date.now();

      const state = useRecordingStore.getState();
      expect(state.status).toBe('paused');
      expect(state._pauseStart).toBeGreaterThanOrEqual(before);
      expect(state._pauseStart).toBeLessThanOrEqual(after);
    });

    it('is ignored when idle', () => {
      useRecordingStore.getState().pauseRecording();
      expect(useRecordingStore.getState().status).toBe('idle');
      expect(useRecordingStore.getState()._pauseStart).toBeNull();
    });

    it('is ignored when already paused', () => {
      const dateNowSpy = jest.spyOn(Date, 'now');
      dateNowSpy.mockReturnValue(1000);
      useRecordingStore.getState().startRecording('Ride', 'gps');

      dateNowSpy.mockReturnValue(5000);
      useRecordingStore.getState().pauseRecording();
      const pauseStart = useRecordingStore.getState()._pauseStart;

      // Second pause call should be ignored (status is 'paused', not 'recording')
      dateNowSpy.mockReturnValue(8000);
      useRecordingStore.getState().pauseRecording();
      expect(useRecordingStore.getState()._pauseStart).toBe(pauseStart);
    });

    it('is ignored when stopped', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      useRecordingStore.getState().stopRecording();
      useRecordingStore.getState().pauseRecording();
      expect(useRecordingStore.getState().status).toBe('stopped');
    });
  });

  describe('resumeRecording()', () => {
    it('transitions from paused to recording and accumulates pausedDuration', () => {
      const dateNowSpy = jest.spyOn(Date, 'now');

      dateNowSpy.mockReturnValue(1000);
      useRecordingStore.getState().startRecording('Ride', 'gps');

      dateNowSpy.mockReturnValue(5000);
      useRecordingStore.getState().pauseRecording();

      dateNowSpy.mockReturnValue(8000);
      useRecordingStore.getState().resumeRecording();

      const state = useRecordingStore.getState();
      expect(state.status).toBe('recording');
      expect(state.pausedDuration).toBe(3000); // 8000 - 5000
      expect(state._pauseStart).toBeNull();
    });

    it('is ignored when recording (not paused)', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      useRecordingStore.getState().resumeRecording();
      expect(useRecordingStore.getState().status).toBe('recording');
      expect(useRecordingStore.getState().pausedDuration).toBe(0);
    });

    it('is ignored when idle', () => {
      useRecordingStore.getState().resumeRecording();
      expect(useRecordingStore.getState().status).toBe('idle');
    });

    it('is ignored when stopped', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      useRecordingStore.getState().stopRecording();
      useRecordingStore.getState().resumeRecording();
      expect(useRecordingStore.getState().status).toBe('stopped');
    });
  });

  describe('stopRecording()', () => {
    it('transitions from recording to stopped', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      useRecordingStore.getState().stopRecording();

      const state = useRecordingStore.getState();
      expect(state.status).toBe('stopped');
      expect(state._pauseStart).toBeNull();
    });

    it('accumulates final pause duration when stopping from paused state', () => {
      const dateNowSpy = jest.spyOn(Date, 'now');

      dateNowSpy.mockReturnValue(1000);
      useRecordingStore.getState().startRecording('Ride', 'gps');

      dateNowSpy.mockReturnValue(5000);
      useRecordingStore.getState().pauseRecording();

      dateNowSpy.mockReturnValue(10000);
      useRecordingStore.getState().stopRecording();

      const state = useRecordingStore.getState();
      expect(state.status).toBe('stopped');
      expect(state.pausedDuration).toBe(5000); // 10000 - 5000
      expect(state._pauseStart).toBeNull();
    });

    it('preserves existing pausedDuration when stopping from recording', () => {
      const dateNowSpy = jest.spyOn(Date, 'now');

      dateNowSpy.mockReturnValue(1000);
      useRecordingStore.getState().startRecording('Ride', 'gps');

      // Pause for 2s
      dateNowSpy.mockReturnValue(3000);
      useRecordingStore.getState().pauseRecording();
      dateNowSpy.mockReturnValue(5000);
      useRecordingStore.getState().resumeRecording();

      // Stop from recording state
      dateNowSpy.mockReturnValue(8000);
      useRecordingStore.getState().stopRecording();

      expect(useRecordingStore.getState().pausedDuration).toBe(2000);
    });

    it('is ignored when idle', () => {
      useRecordingStore.getState().stopRecording();
      expect(useRecordingStore.getState().status).toBe('idle');
    });

    it('is ignored when already stopped', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      useRecordingStore.getState().stopRecording();
      // Second stop should be ignored
      useRecordingStore.getState().stopRecording();
      expect(useRecordingStore.getState().status).toBe('stopped');
    });
  });

  describe('reset()', () => {
    it('returns to idle with all data cleared', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const startTime = useRecordingStore.getState().startTime!;
      useRecordingStore.getState().addGpsPoint({
        latitude: 45.0,
        longitude: 10.0,
        altitude: 100,
        accuracy: 5,
        speed: 8,
        heading: 90,
        timestamp: startTime + 1000,
      });
      useRecordingStore.getState().reset();

      const state = useRecordingStore.getState();
      expect(state.status).toBe('idle');
      expect(state.activityType).toBeNull();
      expect(state.mode).toBeNull();
      expect(state.startTime).toBeNull();
      expect(state.pausedDuration).toBe(0);
      expect(state.streams.time).toEqual([]);
      expect(state.streams.latlng).toEqual([]);
      expect(state.streams.distance).toEqual([]);
      expect(state.laps).toEqual([]);
      expect(state.pairedEventId).toBeNull();
      expect(state.connectedSensors).toEqual([]);
      expect(state._pauseStart).toBeNull();
    });
  });

  describe('addGpsPoint()', () => {
    const makePoint = (overrides: Partial<RecordingGpsPoint> = {}): RecordingGpsPoint => ({
      latitude: 45.0,
      longitude: 10.0,
      altitude: 100,
      accuracy: 5,
      speed: 8,
      heading: 0,
      timestamp: Date.now(),
      ...overrides,
    });

    it('only adds points while recording', () => {
      const point = makePoint();

      // Idle — should not add
      useRecordingStore.getState().addGpsPoint(point);
      expect(useRecordingStore.getState().streams.time).toEqual([]);

      // Recording — should add
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const startTime = useRecordingStore.getState().startTime!;
      useRecordingStore.getState().addGpsPoint(makePoint({ timestamp: startTime + 1000 }));
      expect(useRecordingStore.getState().streams.time).toHaveLength(1);

      // Paused — should not add
      useRecordingStore.getState().pauseRecording();
      useRecordingStore.getState().addGpsPoint(makePoint({ timestamp: startTime + 2000 }));
      expect(useRecordingStore.getState().streams.time).toHaveLength(1);

      // Stopped — should not add
      useRecordingStore.getState().resumeRecording();
      useRecordingStore.getState().stopRecording();
      useRecordingStore.getState().addGpsPoint(makePoint({ timestamp: startTime + 3000 }));
      expect(useRecordingStore.getState().streams.time).toHaveLength(1);
    });

    it('computes cumulative distance via haversine', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const startTime = useRecordingStore.getState().startTime!;

      // Two points ~111m apart (0.001° latitude ≈ 111m)
      useRecordingStore
        .getState()
        .addGpsPoint(makePoint({ latitude: 45.0, longitude: 10.0, timestamp: startTime + 1000 }));
      useRecordingStore
        .getState()
        .addGpsPoint(makePoint({ latitude: 45.001, longitude: 10.0, timestamp: startTime + 2000 }));

      const { streams } = useRecordingStore.getState();
      expect(streams.distance).toHaveLength(2);
      expect(streams.distance[0]).toBe(0); // First point: no previous
      expect(streams.distance[1]).toBeGreaterThan(100);
      expect(streams.distance[1]).toBeLessThan(120);
    });

    it('accumulates distance over multiple points', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const startTime = useRecordingStore.getState().startTime!;

      useRecordingStore
        .getState()
        .addGpsPoint(makePoint({ latitude: 45.0, longitude: 10.0, timestamp: startTime + 1000 }));
      useRecordingStore
        .getState()
        .addGpsPoint(makePoint({ latitude: 45.001, longitude: 10.0, timestamp: startTime + 2000 }));
      useRecordingStore
        .getState()
        .addGpsPoint(makePoint({ latitude: 45.002, longitude: 10.0, timestamp: startTime + 3000 }));

      const { streams } = useRecordingStore.getState();
      expect(streams.distance[2]).toBeGreaterThan(streams.distance[1]);
      // Third point distance should be roughly double the second
      expect(streams.distance[2]).toBeGreaterThan(200);
      expect(streams.distance[2]).toBeLessThan(240);
    });

    it('records elapsed time in seconds', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const startTime = useRecordingStore.getState().startTime!;

      useRecordingStore.getState().addGpsPoint(makePoint({ timestamp: startTime + 5000 }));

      expect(useRecordingStore.getState().streams.time[0]).toBe(5); // 5000ms / 1000
    });

    it('records latlng as [lat, lng] tuples', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const startTime = useRecordingStore.getState().startTime!;

      useRecordingStore
        .getState()
        .addGpsPoint(
          makePoint({ latitude: 48.8566, longitude: 2.3522, timestamp: startTime + 1000 })
        );

      const { streams } = useRecordingStore.getState();
      expect(streams.latlng[0]).toEqual([48.8566, 2.3522]);
    });

    it('records altitude from GPS point', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const startTime = useRecordingStore.getState().startTime!;

      useRecordingStore
        .getState()
        .addGpsPoint(makePoint({ altitude: 350, timestamp: startTime + 1000 }));

      expect(useRecordingStore.getState().streams.altitude[0]).toBe(350);
    });

    it('computes speed from delta distance / delta time', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const startTime = useRecordingStore.getState().startTime!;

      useRecordingStore
        .getState()
        .addGpsPoint(makePoint({ latitude: 45.0, longitude: 10.0, timestamp: startTime + 1000 }));
      useRecordingStore
        .getState()
        .addGpsPoint(makePoint({ latitude: 45.001, longitude: 10.0, timestamp: startTime + 2000 }));

      const { streams } = useRecordingStore.getState();
      // Speed should be ~111 m/s (111m in 1s) — matches delta distance / delta time
      expect(streams.speed[1]).toBeGreaterThan(100);
      expect(streams.speed[1]).toBeLessThan(120);
    });

    it('uses point.speed for first GPS point (no previous reference)', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      const startTime = useRecordingStore.getState().startTime!;

      useRecordingStore
        .getState()
        .addGpsPoint(makePoint({ speed: 7.5, timestamp: startTime + 1000 }));

      expect(useRecordingStore.getState().streams.speed[0]).toBe(7.5);
    });
  });

  describe('addHeartrate()', () => {
    it('appends HR value while recording', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      useRecordingStore.getState().addHeartrate(145, Date.now());
      useRecordingStore.getState().addHeartrate(150, Date.now());

      expect(useRecordingStore.getState().streams.heartrate).toEqual([145, 150]);
    });

    it('is ignored when not recording', () => {
      useRecordingStore.getState().addHeartrate(145, Date.now());
      expect(useRecordingStore.getState().streams.heartrate).toEqual([]);
    });
  });

  describe('addPower()', () => {
    it('appends power value while recording', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      useRecordingStore.getState().addPower(200, Date.now());
      useRecordingStore.getState().addPower(220, Date.now());

      expect(useRecordingStore.getState().streams.power).toEqual([200, 220]);
    });

    it('is ignored when not recording', () => {
      useRecordingStore.getState().addPower(200, Date.now());
      expect(useRecordingStore.getState().streams.power).toEqual([]);
    });
  });

  describe('addCadence()', () => {
    it('appends cadence value while recording', () => {
      useRecordingStore.getState().startRecording('Ride', 'gps');
      useRecordingStore.getState().addCadence(90, Date.now());
      useRecordingStore.getState().addCadence(92, Date.now());

      expect(useRecordingStore.getState().streams.cadence).toEqual([90, 92]);
    });

    it('is ignored when not recording', () => {
      useRecordingStore.getState().addCadence(90, Date.now());
      expect(useRecordingStore.getState().streams.cadence).toEqual([]);
    });
  });

  describe('addLap()', () => {
    it('records lap with correct start/end times', () => {
      const dateNowSpy = jest.spyOn(Date, 'now');
      dateNowSpy.mockReturnValue(1000);
      useRecordingStore.getState().startRecording('Ride', 'gps');

      // Add GPS point at 1s elapsed
      useRecordingStore.getState().addGpsPoint({
        latitude: 45.0,
        longitude: 10.0,
        altitude: 100,
        accuracy: 5,
        speed: 8,
        heading: 0,
        timestamp: 2000,
      });

      dateNowSpy.mockReturnValue(6000);
      useRecordingStore.getState().addLap();

      const { laps } = useRecordingStore.getState();
      expect(laps).toHaveLength(1);
      expect(laps[0].index).toBe(0);
      expect(laps[0].startTime).toBe(0); // First lap starts at 0
      expect(laps[0].endTime).toBe(5); // (6000 - 1000 - 0) / 1000 = 5s
    });

    it('is ignored when not recording', () => {
      useRecordingStore.getState().addLap();
      expect(useRecordingStore.getState().laps).toEqual([]);
    });

    it('sequential laps have contiguous start/end times', () => {
      const dateNowSpy = jest.spyOn(Date, 'now');
      dateNowSpy.mockReturnValue(1000);
      useRecordingStore.getState().startRecording('Ride', 'gps');

      useRecordingStore.getState().addGpsPoint({
        latitude: 45.0,
        longitude: 10.0,
        altitude: 100,
        accuracy: 5,
        speed: 8,
        heading: 0,
        timestamp: 2000,
      });

      dateNowSpy.mockReturnValue(6000);
      useRecordingStore.getState().addLap();

      dateNowSpy.mockReturnValue(11000);
      useRecordingStore.getState().addLap();

      const { laps } = useRecordingStore.getState();
      expect(laps).toHaveLength(2);
      // Second lap starts where first lap ended
      expect(laps[1].startTime).toBe(laps[0].endTime);
      expect(laps[1].index).toBe(1);
    });
  });

  describe('multiple pause/resume cycles', () => {
    it('accumulates duration correctly across cycles', () => {
      const dateNowSpy = jest.spyOn(Date, 'now');

      dateNowSpy.mockReturnValue(1000);
      useRecordingStore.getState().startRecording('Ride', 'gps');

      // First pause: 2s
      dateNowSpy.mockReturnValue(5000);
      useRecordingStore.getState().pauseRecording();
      dateNowSpy.mockReturnValue(7000);
      useRecordingStore.getState().resumeRecording();
      expect(useRecordingStore.getState().pausedDuration).toBe(2000);

      // Second pause: 3s
      dateNowSpy.mockReturnValue(10000);
      useRecordingStore.getState().pauseRecording();
      dateNowSpy.mockReturnValue(13000);
      useRecordingStore.getState().resumeRecording();
      expect(useRecordingStore.getState().pausedDuration).toBe(5000); // 2000 + 3000

      // Third pause then stop: 1s
      dateNowSpy.mockReturnValue(15000);
      useRecordingStore.getState().pauseRecording();
      dateNowSpy.mockReturnValue(16000);
      useRecordingStore.getState().stopRecording();
      expect(useRecordingStore.getState().pausedDuration).toBe(6000); // 5000 + 1000
    });
  });

  describe('getRecordingStatus()', () => {
    it('returns current status synchronously', () => {
      expect(getRecordingStatus()).toBe('idle');

      useRecordingStore.getState().startRecording('Ride', 'gps');
      expect(getRecordingStatus()).toBe('recording');

      useRecordingStore.getState().pauseRecording();
      expect(getRecordingStatus()).toBe('paused');

      useRecordingStore.getState().stopRecording();
      expect(getRecordingStatus()).toBe('stopped');
    });
  });
});
