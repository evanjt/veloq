/**
 * Scenario: an athlete pauses a ride, waits, and resumes, while the screen, the
 * notification and the Live Activity all show the ride.
 * Expected behaviour: moving time and lap time freeze on every surface through
 * the pause and carry on from the same value on resume, and the live averages
 * and calories divide by the time spent moving, as the saved ride does.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useRecordingStore, movingMsAt } from '@/features/recording/stores/RecordingStore';
import { useTimer } from '@/features/recording/hooks/useTimer';
import { useRecordingMetrics } from '@/features/recording/hooks/useRecordingMetrics';
import { buildRecordingNotificationPayload } from '@/features/recording/lib/recordingNotification';
import {
  beginLiveActivity,
  finishLiveActivity,
  refreshLiveActivity,
} from '@/features/recording/lib/liveActivity/controller';

const mockCards: string[] = [];

jest.mock('@/features/recording/lib/liveActivity/bridge', () => ({
  isLiveActivitySupported: () => true,
  startNativeLiveActivity: (_attributes: string, state: string) => mockCards.push(state),
  updateNativeLiveActivity: (state: string) => mockCards.push(state),
  endNativeLiveActivity: () => undefined,
  endAllNativeLiveActivities: () => undefined,
  onLiveActivityControl: () => () => undefined,
}));

function lastCard(): { status: string; frozenElapsedS: number; timerFrom: number } {
  return JSON.parse(mockCards[mockCards.length - 1]);
}

const translate = (_key: string, fallback: string) => fallback;

function start(): void {
  useRecordingStore.getState().startRecording('Ride', 'gps');
}

async function advance(ms: number): Promise<void> {
  await act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('moving time through a pause', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_000_000);
    useRecordingStore.getState().reset();
  });

  afterEach(() => {
    useRecordingStore.getState().reset();
    jest.useRealTimers();
  });

  it('freezes the screen timer while paused and does not jump on resume', async () => {
    start();
    const { result, rerender } = await renderHook(() => useTimer());
    await advance(30_000);
    expect(result.current.movingTime).toBe(30);

    await act(() => useRecordingStore.getState().pauseRecording());
    // The screen keeps re-rendering through a pause: the metrics tick runs
    // whatever the status.
    await advance(60_000);
    await rerender({});
    expect(result.current.movingTime).toBe(30);
    expect(result.current.formattedMoving).toBe('00:30');

    await advance(240_000);
    await rerender({});
    expect(result.current.movingTime).toBe(30);

    await act(() => useRecordingStore.getState().resumeRecording());
    await rerender({});
    expect(result.current.movingTime).toBe(30);

    await advance(10_000);
    expect(result.current.movingTime).toBe(40);
  });

  it('keeps the elapsed reading counting through a pause with no other clock reader', async () => {
    start();
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      const { formattedElapsed, formattedMoving } = useTimer();
      return { formattedElapsed, formattedMoving };
    });
    await advance(10_000);
    expect(result.current.formattedElapsed).toBe('00:10');

    await act(() => useRecordingStore.getState().pauseRecording());
    renders = 0;
    for (let i = 0; i < 60; i += 1) await advance(1000);
    expect(renders).toBe(60);
    expect(result.current.formattedElapsed).toBe('01:10');
    expect(result.current.formattedMoving).toBe('00:10');

    await act(() => useRecordingStore.getState().resumeRecording());
    expect(result.current.formattedElapsed).toBe('01:10');
    expect(result.current.formattedMoving).toBe('00:10');

    await advance(1000);
    expect(result.current.formattedElapsed).toBe('01:11');
    expect(result.current.formattedMoving).toBe('00:11');
  });

  it('stops the clock once the ride is stopped', async () => {
    start();
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return useTimer().formattedElapsed;
    });
    await advance(5000);
    await act(() => useRecordingStore.getState().pauseRecording());
    await advance(5000);
    await act(() => useRecordingStore.getState().stopRecording());
    renders = 0;
    await advance(60_000);
    expect(renders).toBe(0);
    expect(result.current).toBe('00:10');
  });

  it('gives the screen, the notification and the store one moving time mid-pause', async () => {
    start();
    const { result, rerender } = await renderHook(() => useTimer());
    await advance(30_000);
    await act(() => useRecordingStore.getState().pauseRecording());
    await advance(300_000);
    await rerender({});

    const now = Date.now();
    const state = useRecordingStore.getState();
    const payload = buildRecordingNotificationPayload(state, {
      translate,
      isMetric: true,
      now,
    });
    expect(movingMsAt(state, now)).toBe(30_000);
    expect(payload?.elapsedText).toBe('Paused · 0:30');
    expect(result.current.movingTime).toBe(30);
  });

  it('counts a closed pause once and an open pause once', async () => {
    start();
    await advance(20_000);
    await act(() => useRecordingStore.getState().pauseRecording());
    await advance(10_000);
    await act(() => useRecordingStore.getState().resumeRecording());
    await advance(20_000);
    await act(() => useRecordingStore.getState().pauseRecording());
    await advance(15_000);
    expect(movingMsAt(useRecordingStore.getState(), Date.now())).toBe(40_000);
  });

  it('is zero before a start', () => {
    expect(movingMsAt(useRecordingStore.getState(), Date.now())).toBe(0);
  });

  it('holds the finished times on a stopped ride rather than zero or a running clock', async () => {
    start();
    const { result, rerender } = await renderHook(() => useTimer());
    await advance(30_000);
    await act(() => useRecordingStore.getState().pauseRecording());
    await advance(10_000);
    await act(() => useRecordingStore.getState().stopRecording());
    await advance(600_000);
    await rerender({});

    expect(result.current.movingTime).toBe(30);
    expect(result.current.elapsedTime).toBe(40);
  });
});

describe('live averages over moving time', () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    useRecordingStore.getState().reset();
  });

  afterEach(() => {
    useRecordingStore.getState().reset();
    jest.useRealTimers();
  });

  function rideWithACafeStop(extra: Record<string, unknown> = {}) {
    // 20 km in 60 min of wall clock, 20 of them at a café: 40 min moving.
    useRecordingStore.setState({
      status: 'recording',
      activityType: 'Ride',
      mode: 'gps',
      startTime: NOW - 3_600_000,
      pausedDuration: 1_200_000,
      pauseIntervals: [{ start: 1200, end: 2400 }],
      streams: {
        time: [0, 1200, 2400, 3600],
        latlng: [],
        altitude: [NaN, NaN, NaN, NaN],
        heartrate: [0, 0, 0, 0],
        power: [0, 0, 0, 0],
        cadence: [0, 0, 0, 0],
        speed: [0, 8, 0, 8],
        distance: [0, 10_000, 10_000, 20_000],
      },
      ...extra,
    });
  }

  it('divides distance by moving time, not wall clock', async () => {
    rideWithACafeStop();
    const { result } = await renderHook(() => useRecordingMetrics());
    // 20 km over 40 min is 30 km/h.
    expect(result.current.avgSpeed * 3.6).toBeCloseTo(30, 5);
  });

  it('estimates calories over moving time', async () => {
    rideWithACafeStop();
    const { result } = await renderHook(() => useRecordingMetrics());
    // No HR: 40 min x 70 kg x MET 8 for a ride.
    expect(result.current.calories).toBe(Math.round((2400 / 3600) * 70 * 8));
  });

  it('shows the same average standing in an open pause as at the last sample', async () => {
    rideWithACafeStop();
    const { result: before } = await renderHook(() => useRecordingMetrics());
    const atLastSample = before.current.avgSpeed;

    // The rider stops again right after the last sample. No sample is appended
    // while paused, so the open pause is not in the stream and must not be
    // subtracted from it.
    useRecordingStore.setState({ status: 'paused', _pauseStart: NOW });
    jest.setSystemTime(NOW + 600_000);
    const { result: after } = await renderHook(() => useRecordingMetrics());
    expect(after.current.avgSpeed).toBeCloseTo(atLastSample, 10);
  });

  it('measures lap time on the moving clock from the last sample', async () => {
    rideWithACafeStop({
      laps: [
        {
          index: 0,
          startTime: 0,
          endTime: 600,
          startIndex: 0,
          endIndex: 0,
          movingEndTime: 600,
          distance: 0,
          avgSpeed: 0,
          avgHeartrate: null,
          avgPower: null,
          avgCadence: null,
        },
      ],
    });
    const { result } = await renderHook(() => useRecordingMetrics());
    expect(result.current.lapTime).toBe(2400 - 600);
  });
});

describe('every surface through a real pause and resume', () => {
  const NORTH = 1 / 111_320;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_000_000);
    useRecordingStore.getState().reset();
    mockCards.length = 0;
  });

  afterEach(() => {
    finishLiveActivity();
    useRecordingStore.getState().reset();
    jest.useRealTimers();
  });

  function fix(metresNorth: number): void {
    useRecordingStore.getState().addGpsPoint({
      latitude: 47 + metresNorth * NORTH,
      longitude: 8,
      altitude: 400,
      accuracy: 5,
      speed: null,
      heading: null,
      timestamp: Date.now(),
    });
  }

  it('keeps average speed, calories and lap time level across a long stop', async () => {
    start();
    fix(0);
    jest.setSystemTime(Date.now() + 600_000);
    fix(5000);
    const { result, rerender } = await renderHook(() => useRecordingMetrics());
    const before = result.current;

    await act(() => useRecordingStore.getState().pauseRecording());
    jest.setSystemTime(Date.now() + 1_200_000);
    await act(() => useRecordingStore.getState().resumeRecording());
    jest.setSystemTime(Date.now() + 1000);
    await act(() => fix(5008));
    await rerender({});

    expect(result.current.avgSpeed).toBeCloseTo(before.avgSpeed, 1);
    expect(result.current.calories - before.calories).toBeLessThanOrEqual(1);
    expect(result.current.lapTime).toBe(601);
  });

  it('shows the Live Activity the same moving time as the screen, mid-pause and after', async () => {
    start();
    const { result, rerender } = await renderHook(() => useTimer());
    await advance(45_000);
    beginLiveActivity();

    await act(() => useRecordingStore.getState().pauseRecording());
    await advance(300_000);
    await rerender({});
    refreshLiveActivity();
    expect(lastCard().frozenElapsedS).toBe(result.current.movingTime);
    expect(result.current.movingTime).toBe(45);

    await act(() => useRecordingStore.getState().resumeRecording());
    await rerender({});
    refreshLiveActivity();
    expect(lastCard().status).toBe('recording');
    expect(lastCard().frozenElapsedS).toBe(result.current.movingTime);
    expect(Math.floor((Date.now() - lastCard().timerFrom) / 1000)).toBe(result.current.movingTime);
  });
});
