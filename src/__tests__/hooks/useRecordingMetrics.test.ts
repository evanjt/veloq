/**
 * Tests for useRecordingMetrics hook
 *
 * Covers: speed, avgSpeed, distance, heartrate, power, cadence, elevation,
 * elevationGain, pace, avgPace, calories, lapDistance, lapTime computation.
 */

import { renderHook } from '@testing-library/react-native';
import { useRecordingStore } from '@/providers/RecordingStore';
import { useRecordingMetrics } from '@/hooks/recording/useRecordingMetrics';
import type { RecordingStreams, RecordingLap } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_STREAMS: RecordingStreams = {
  time: [],
  latlng: [],
  altitude: [],
  heartrate: [],
  power: [],
  cadence: [],
  speed: [],
  distance: [],
};

function resetStore() {
  useRecordingStore.getState().reset();
}

function setStoreState(partial: Record<string, unknown>) {
  useRecordingStore.setState(partial);
}

/** Build streams with reasonable defaults for a simple recording */
function makeStreams(overrides: Partial<RecordingStreams> = {}): RecordingStreams {
  return { ...EMPTY_STREAMS, ...overrides };
}

function makeLap(overrides: Partial<RecordingLap> = {}): RecordingLap {
  return {
    index: 0,
    startTime: 0,
    endTime: 60,
    distance: 1000,
    avgSpeed: 16.67,
    avgHeartrate: null,
    avgPower: null,
    avgCadence: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('useRecordingMetrics', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  // -------------------------------------------------------------------------
  // Empty / no data
  // -------------------------------------------------------------------------

  it('returns all zeros when streams are empty', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      streams: EMPTY_STREAMS,
      laps: [],
    });

    const { result } = renderHook(() => useRecordingMetrics());

    expect(result.current.speed).toBe(0);
    expect(result.current.avgSpeed).toBe(0);
    expect(result.current.distance).toBe(0);
    expect(result.current.heartrate).toBe(0);
    expect(result.current.power).toBe(0);
    expect(result.current.cadence).toBe(0);
    expect(result.current.elevation).toBe(0);
    expect(result.current.elevationGain).toBe(0);
    expect(result.current.pace).toBe(0);
    expect(result.current.avgPace).toBe(0);
    expect(result.current.calories).toBe(0);
    expect(result.current.lapDistance).toBe(0);
    expect(result.current.lapTime).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Current values (last element in streams)
  // -------------------------------------------------------------------------

  it('returns the last element of each stream as current value', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now() - 60000,
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 10, 20, 30],
        speed: [0, 5.0, 7.5, 8.0],
        distance: [0, 50, 125, 205],
        heartrate: [60, 120, 140, 155],
        power: [0, 100, 200, 250],
        cadence: [0, 70, 80, 90],
        altitude: [100, 102, 105, 110],
        latlng: [
          [0, 0],
          [0.001, 0.001],
          [0.002, 0.002],
          [0.003, 0.003],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    expect(result.current.speed).toBe(8.0);
    expect(result.current.distance).toBe(205);
    expect(result.current.heartrate).toBe(155);
    expect(result.current.power).toBe(250);
    expect(result.current.cadence).toBe(90);
    expect(result.current.elevation).toBe(110);
  });

  // -------------------------------------------------------------------------
  // Single data point
  // -------------------------------------------------------------------------

  it('handles a single data point', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0],
        speed: [5.0],
        distance: [0],
        heartrate: [120],
        power: [150],
        cadence: [80],
        altitude: [200],
        latlng: [[48.0, 11.0]],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    expect(result.current.speed).toBe(5.0);
    expect(result.current.distance).toBe(0);
    expect(result.current.heartrate).toBe(120);
    expect(result.current.power).toBe(150);
    expect(result.current.cadence).toBe(80);
    expect(result.current.elevation).toBe(200);
    expect(result.current.elevationGain).toBe(0); // Single point -> no gain
    // time[0] = 0, avgSpeed = 0/0 -> 0
    expect(result.current.avgSpeed).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Average speed
  // -------------------------------------------------------------------------

  it('calculates average speed as distance / elapsed seconds', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now() - 100000,
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 50, 100], // 100 seconds
        speed: [5, 8, 10],
        distance: [0, 400, 1000], // 1000 meters
        altitude: [0, 0, 0],
        latlng: [
          [0, 0],
          [0.001, 0.001],
          [0.002, 0.002],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // avgSpeed = 1000m / 100s = 10 m/s
    expect(result.current.avgSpeed).toBe(10);
  });

  it('returns 0 average speed when elapsed time is 0', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0],
        speed: [0],
        distance: [0],
        altitude: [0],
        latlng: [[0, 0]],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    expect(result.current.avgSpeed).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Pace
  // -------------------------------------------------------------------------

  it('calculates pace as 1000 / speed (seconds per km)', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Run',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 60],
        speed: [0, 4.0], // 4 m/s
        distance: [0, 240],
        altitude: [0, 0],
        latlng: [
          [0, 0],
          [0.001, 0],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // pace = 1000 / 4.0 = 250 seconds per km
    expect(result.current.pace).toBe(250);
  });

  it('returns 0 pace when speed is 0', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Run',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0],
        speed: [0],
        distance: [0],
        altitude: [0],
        latlng: [[0, 0]],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    expect(result.current.pace).toBe(0);
  });

  it('calculates average pace from average speed', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Run',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 200], // 200 seconds
        speed: [3.0, 5.0],
        distance: [0, 1000], // 1000m in 200s -> avgSpeed = 5 m/s
        altitude: [0, 0],
        latlng: [
          [0, 0],
          [0.001, 0],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // avgSpeed = 1000/200 = 5, avgPace = 1000/5 = 200
    expect(result.current.avgPace).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Elevation gain
  // -------------------------------------------------------------------------

  it('sums only positive altitude differences for elevation gain', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 10, 20, 30, 40],
        speed: [5, 5, 5, 5, 5],
        distance: [0, 50, 100, 150, 200],
        altitude: [100, 120, 110, 130, 125], // +20, -10, +20, -5
        latlng: [
          [0, 0],
          [0.001, 0],
          [0.002, 0],
          [0.003, 0],
          [0.004, 0],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // Positive diffs: 20 + 20 = 40
    expect(result.current.elevationGain).toBe(40);
  });

  it('returns 0 elevation gain on flat terrain', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 10, 20],
        speed: [5, 5, 5],
        distance: [0, 50, 100],
        altitude: [100, 100, 100],
        latlng: [
          [0, 0],
          [0.001, 0],
          [0.002, 0],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    expect(result.current.elevationGain).toBe(0);
  });

  it('returns 0 elevation gain on pure descent', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 10, 20],
        speed: [5, 5, 5],
        distance: [0, 50, 100],
        altitude: [300, 200, 100],
        latlng: [
          [0, 0],
          [0.001, 0],
          [0.002, 0],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    expect(result.current.elevationGain).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Calories
  // -------------------------------------------------------------------------

  it('estimates calories for cycling (MET 8)', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 3600], // 1 hour
        speed: [5, 5],
        distance: [0, 18000],
        altitude: [0, 0],
        latlng: [
          [0, 0],
          [0.1, 0],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // calories = 1 hour * 70 kg * 8 MET = 560
    expect(result.current.calories).toBe(560);
  });

  it('estimates calories for running (MET 10)', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Run',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 1800], // 30 minutes
        speed: [3, 4],
        distance: [0, 5000],
        altitude: [0, 0],
        latlng: [
          [0, 0],
          [0.01, 0],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // calories = 0.5 hours * 70 kg * 10 MET = 350
    expect(result.current.calories).toBe(350);
  });

  it('estimates calories for walking/hiking (MET 4)', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Hike',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 7200], // 2 hours
        speed: [1.5, 1.5],
        distance: [0, 10800],
        altitude: [0, 0],
        latlng: [
          [0, 0],
          [0.01, 0],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // calories = 2 hours * 70 kg * 4 MET = 560
    expect(result.current.calories).toBe(560);
  });

  it('estimates calories for swimming (MET 7)', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Swim',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 3600],
        speed: [1, 1.5],
        distance: [0, 2000],
        altitude: [0, 0],
        latlng: [
          [0, 0],
          [0.01, 0],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // calories = 1 hour * 70 kg * 7 MET = 490
    expect(result.current.calories).toBe(490);
  });

  it('uses default MET (6) for unknown activity types', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Other',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 3600],
        speed: [2, 2],
        distance: [0, 7200],
        altitude: [0, 0],
        latlng: [
          [0, 0],
          [0.01, 0],
        ],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // calories = 1 hour * 70 kg * 6 MET = 420
    expect(result.current.calories).toBe(420);
  });

  it('returns 0 calories when elapsed time is 0', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0],
        speed: [5],
        distance: [0],
        altitude: [0],
        latlng: [[0, 0]],
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    expect(result.current.calories).toBe(0);
  });

  // -------------------------------------------------------------------------
  // MET classification by activity type name
  // -------------------------------------------------------------------------

  it('recognises cycling-related activity types', () => {
    for (const type of ['Ride', 'VirtualRide', 'MountainBikeRide', 'Cycling']) {
      setStoreState({
        activityType: type,
        streams: makeStreams({
          time: [0, 3600],
          speed: [5, 5],
          distance: [0, 18000],
          altitude: [0, 0],
          latlng: [
            [0, 0],
            [0.01, 0],
          ],
        }),
        laps: [],
        pausedDuration: 0,
        startTime: Date.now(),
      });

      const { result } = renderHook(() => useRecordingMetrics());
      // MET 8: 1h * 70kg * 8 = 560
      expect(result.current.calories).toBe(560);
    }
  });

  it('recognises running-related activity types', () => {
    for (const type of ['Run', 'Treadmill']) {
      setStoreState({
        activityType: type,
        streams: makeStreams({
          time: [0, 3600],
          speed: [3, 4],
          distance: [0, 12600],
          altitude: [0, 0],
          latlng: [
            [0, 0],
            [0.01, 0],
          ],
        }),
        laps: [],
        pausedDuration: 0,
        startTime: Date.now(),
      });

      const { result } = renderHook(() => useRecordingMetrics());
      // MET 10: 1h * 70kg * 10 = 700
      expect(result.current.calories).toBe(700);
    }
  });

  // -------------------------------------------------------------------------
  // Lap metrics
  // -------------------------------------------------------------------------

  it('calculates lap distance from last lap end position', () => {
    // The hook uses lastLap.endTime as an index into streams.distance:
    // lapStartDistance = streams.distance[Math.min(Math.round(endTime), lastIdx)]
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      streams: makeStreams({
        time: [0, 30, 60, 90, 120],
        speed: [5, 5, 5, 5, 5],
        distance: [0, 250, 500, 750, 1000],
        altitude: [0, 0, 0, 0, 0],
        latlng: [
          [0, 0],
          [0.001, 0],
          [0.002, 0],
          [0.003, 0],
          [0.004, 0],
        ],
      }),
      laps: [
        makeLap({
          index: 0,
          startTime: 0,
          endTime: 2, // endTime used as index -> streams.distance[2] = 500
          distance: 500,
        }),
      ],
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // Total distance 1000, lapStartDistance = streams.distance[2] = 500
    // lapDistance = 1000 - 500 = 500
    expect(result.current.lapDistance).toBe(500);
  });

  it('returns full distance as lap distance when no laps exist', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      streams: makeStreams({
        time: [0, 30, 60],
        speed: [5, 5, 5],
        distance: [0, 250, 500],
        altitude: [0, 0, 0],
        latlng: [
          [0, 0],
          [0.001, 0],
          [0.002, 0],
        ],
      }),
      laps: [],
    });

    const { result } = renderHook(() => useRecordingMetrics());

    expect(result.current.lapDistance).toBe(500);
  });

  it('calculates lap time from moving time minus last lap endTime', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      streams: makeStreams({
        time: [0, 30, 60, 90, 120],
        speed: [5, 5, 5, 5, 5],
        distance: [0, 250, 500, 750, 1000],
        altitude: [0, 0, 0, 0, 0],
        latlng: [
          [0, 0],
          [0.001, 0],
          [0.002, 0],
          [0.003, 0],
          [0.004, 0],
        ],
      }),
      laps: [
        makeLap({
          index: 0,
          startTime: 0,
          endTime: 60,
          distance: 500,
        }),
      ],
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // elapsedSeconds = time[4] = 120, pausedDuration = 0
    // movingSeconds = 120, lapStartSeconds = 60
    // lapTime = 120 - 60 = 60
    expect(result.current.lapTime).toBe(60);
  });

  it('lap time accounts for paused duration', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 20000, // 20 seconds paused
      streams: makeStreams({
        time: [0, 30, 60, 90, 120],
        speed: [5, 5, 5, 5, 5],
        distance: [0, 250, 500, 750, 1000],
        altitude: [0, 0, 0, 0, 0],
        latlng: [
          [0, 0],
          [0.001, 0],
          [0.002, 0],
          [0.003, 0],
          [0.004, 0],
        ],
      }),
      laps: [
        makeLap({
          index: 0,
          startTime: 0,
          endTime: 60,
          distance: 500,
        }),
      ],
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // elapsedSeconds = 120, pausedDuration = 20s
    // movingSeconds = 120 - 20 = 100
    // lapTime = 100 - 60 = 40
    expect(result.current.lapTime).toBe(40);
  });

  it('lap time never goes negative', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 100000, // More than total elapsed
      streams: makeStreams({
        time: [0, 30, 60],
        speed: [5, 5, 5],
        distance: [0, 250, 500],
        altitude: [0, 0, 0],
        latlng: [
          [0, 0],
          [0.001, 0],
          [0.002, 0],
        ],
      }),
      laps: [
        makeLap({
          index: 0,
          startTime: 0,
          endTime: 30,
          distance: 250,
        }),
      ],
    });

    const { result } = renderHook(() => useRecordingMetrics());

    expect(result.current.lapTime).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // Null/undefined handling in streams
  // -------------------------------------------------------------------------

  it('treats missing stream values as 0 via nullish coalescing', () => {
    // Simulate sparse streams where some arrays are shorter
    const streams: RecordingStreams = {
      time: [0, 30],
      latlng: [[0, 0]],
      altitude: [],
      heartrate: [],
      power: [],
      cadence: [],
      speed: [5],
      distance: [0],
    };

    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams,
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // Should not throw; values default to 0 for missing indices
    expect(result.current.heartrate).toBe(0);
    expect(result.current.power).toBe(0);
    expect(result.current.cadence).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Recomputation on stream changes
  // -------------------------------------------------------------------------

  it('recomputes when streams change', () => {
    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now(),
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time: [0, 10],
        speed: [0, 5],
        distance: [0, 50],
        altitude: [100, 100],
        latlng: [
          [0, 0],
          [0.001, 0],
        ],
      }),
    });

    const { result, rerender } = renderHook(() => useRecordingMetrics());

    expect(result.current.distance).toBe(50);

    // Add more data points
    setStoreState({
      streams: makeStreams({
        time: [0, 10, 20],
        speed: [0, 5, 8],
        distance: [0, 50, 130],
        altitude: [100, 100, 105],
        latlng: [
          [0, 0],
          [0.001, 0],
          [0.002, 0],
        ],
      }),
    });

    rerender({});

    expect(result.current.distance).toBe(130);
    expect(result.current.speed).toBe(8);
    expect(result.current.elevationGain).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Integration: realistic cycling recording
  // -------------------------------------------------------------------------

  it('produces coherent metrics for a realistic 10-minute ride', () => {
    // 10 minutes, covering 3km, climbing 50m
    const numPoints = 11; // one every 60 seconds
    const time: number[] = [];
    const speed: number[] = [];
    const distance: number[] = [];
    const altitude: number[] = [];
    const heartrate: number[] = [];
    const latlng: [number, number][] = [];

    for (let i = 0; i < numPoints; i++) {
      time.push(i * 60); // every 60s
      speed.push(5.0); // constant 5 m/s (18 km/h)
      distance.push(i * 300); // 300m per interval
      altitude.push(100 + i * 5); // steady 5m climb per interval
      heartrate.push(120 + i * 2);
      latlng.push([48.0 + i * 0.001, 11.0]);
    }

    setStoreState({
      status: 'recording',
      activityType: 'Ride',
      startTime: Date.now() - 600000,
      pausedDuration: 0,
      laps: [],
      streams: makeStreams({
        time,
        speed,
        distance,
        altitude,
        heartrate,
        power: [],
        cadence: [],
        latlng,
      }),
    });

    const { result } = renderHook(() => useRecordingMetrics());

    // Distance: 10 * 300 = 3000m
    expect(result.current.distance).toBe(3000);

    // Avg speed: 3000m / 600s = 5 m/s
    expect(result.current.avgSpeed).toBe(5);

    // Speed: last = 5
    expect(result.current.speed).toBe(5);

    // Elevation: last = 100 + 10*5 = 150
    expect(result.current.elevation).toBe(150);

    // Elevation gain: 10 * 5 = 50
    expect(result.current.elevationGain).toBe(50);

    // Pace: 1000 / 5 = 200 s/km
    expect(result.current.pace).toBe(200);

    // Heartrate: last = 120 + 10*2 = 140
    expect(result.current.heartrate).toBe(140);

    // Calories: (600/3600) * 70 * 8 = 93.33 -> rounded to 93
    expect(result.current.calories).toBeCloseTo(93, 0);
  });
});
