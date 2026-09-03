import { haversineDistance } from '@/shared/geo/distance';
import { create } from 'zustand';

import { getMaxPlausibleSpeed } from '@/features/recording/lib/sportCategoryDetector';
import type { PauseInterval } from '@/features/recording/lib/pausedTime';
import type {
  ActivityType,
  RecordingMode,
  RecordingStatus,
  RecordingStreams,
  RecordingGpsPoint,
  RecordingLap,
} from '@/types';

/** Sensor values older than this are stale and recorded as 0 (FIT no-data). */
const SENSOR_STALE_MS = 5000;

interface SensorSampleLite {
  value: number;
  at: number;
}

type SensorStreamKind = 'heartrate' | 'power' | 'cadence';

function freshValue(sample: SensorSampleLite | null, now: number): number {
  if (!sample) return 0;
  return now - sample.at <= SENSOR_STALE_MS ? sample.value : 0;
}

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

interface RecordingState {
  status: RecordingStatus;
  activityType: ActivityType | null;
  mode: RecordingMode | null;
  startTime: number | null;
  stopTime: number | null;
  pausedDuration: number;
  /** Each pause as elapsed seconds since startTime, so any stream window can subtract its own. */
  pauseIntervals: PauseInterval[];
  streams: RecordingStreams;
  laps: RecordingLap[];
  pairedEventId: number | null;
  /** Sample-and-hold of the latest sensor values, written by the sensors feature. */
  latestSensor: Record<SensorStreamKind, SensorSampleLite | null>;
  /**
   * Speed from the last raw location fix, written whether or not points are
   * being recorded. Auto-pause needs a signal that survives a pause, and
   * `streams.speed` stops growing the moment `addGpsPoint` starts refusing.
   */
  rawSpeed: SensorSampleLite | null;
  // Internal: previous raw fix, so speed can be derived when the OS omits it
  _lastRawFix: { latitude: number; longitude: number; timestamp: number } | null;
  // Internal: track pause start for duration accumulation
  _pauseStart: number | null;
  // Actions
  startRecording: (type: ActivityType, mode: RecordingMode, pairedEventId?: number) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  changeActivityType: (type: ActivityType) => void;
  addGpsPoint: (point: RecordingGpsPoint) => void;
  setRawLocationFix: (fix: RecordingGpsPoint) => void;
  setSensorSample: (kind: SensorStreamKind, value: number) => void;
  /** Indoor mode has no GPS points; a 1 Hz tick appends aligned sensor samples instead. */
  addIndoorSample: () => void;
  addLap: () => void;
  reset: () => void;
}

function closePause(
  intervals: PauseInterval[],
  startTime: number | null,
  pauseStart: number | null,
  now: number
): PauseInterval[] {
  if (!startTime || !pauseStart) return intervals;
  return [...intervals, { start: (pauseStart - startTime) / 1000, end: (now - startTime) / 1000 }];
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  status: 'idle',
  activityType: null,
  mode: null,
  startTime: null,
  stopTime: null,
  pausedDuration: 0,
  pauseIntervals: [],
  streams: { ...EMPTY_STREAMS },
  laps: [],
  pairedEventId: null,
  latestSensor: { heartrate: null, power: null, cadence: null },
  rawSpeed: null,
  _lastRawFix: null,
  _pauseStart: null,

  startRecording: (type, mode, pairedEventId) => {
    set({
      status: 'recording',
      activityType: type,
      mode,
      startTime: Date.now(),
      pausedDuration: 0,
      pauseIntervals: [],
      streams: {
        time: [],
        latlng: [],
        altitude: [],
        heartrate: [],
        power: [],
        cadence: [],
        speed: [],
        distance: [],
      },
      laps: [],
      pairedEventId: pairedEventId ?? null,
      latestSensor: { heartrate: null, power: null, cadence: null },
      rawSpeed: null,
      _lastRawFix: null,
      _pauseStart: null,
    });
  },

  pauseRecording: () => {
    const { status } = get();
    if (status !== 'recording') return;
    set({ status: 'paused', _pauseStart: Date.now() });
  },

  resumeRecording: () => {
    const { status, _pauseStart, pausedDuration, pauseIntervals, startTime } = get();
    if (status !== 'paused') return;
    const now = Date.now();
    const additionalPause = _pauseStart ? now - _pauseStart : 0;
    set({
      status: 'recording',
      pausedDuration: pausedDuration + additionalPause,
      pauseIntervals: closePause(pauseIntervals, startTime, _pauseStart, now),
      _pauseStart: null,
    });
  },

  stopRecording: () => {
    const { status, _pauseStart, pausedDuration, pauseIntervals, startTime } = get();
    if (status !== 'recording' && status !== 'paused') return;
    const now = Date.now();
    const paused = status === 'paused' && _pauseStart;
    set({
      status: 'stopped',
      stopTime: now,
      pausedDuration: pausedDuration + (paused ? now - _pauseStart! : 0),
      pauseIntervals: paused
        ? closePause(pauseIntervals, startTime, _pauseStart, now)
        : pauseIntervals,
      _pauseStart: null,
    });
  },

  changeActivityType: (type) => {
    const { status } = get();
    if (status === 'idle') return;
    set({ activityType: type });
  },

  addGpsPoint: (point) => {
    const { status, startTime, streams, activityType } = get();
    if (status !== 'recording' || !startTime) return;

    const elapsedSec = (point.timestamp - startTime) / 1000;
    // Drop duplicate / out-of-order points. Foreground watcher and background
    // task can both deliver around a bg->fg transition; only accept points
    // strictly newer than the last, so distance and pace stay monotonic.
    const lastTime = streams.time[streams.time.length - 1];
    if (lastTime !== undefined && elapsedSec <= lastTime) return;

    const prevLatlng = streams.latlng[streams.latlng.length - 1];
    const prevDist = streams.distance[streams.distance.length - 1] ?? 0;

    let dist = prevDist;
    let speed = 0;
    if (prevLatlng) {
      const delta = haversineDistance(
        prevLatlng[0],
        prevLatlng[1],
        point.latitude,
        point.longitude
      );
      const prevTime = streams.time[streams.time.length - 1] ?? 0;
      const dt = elapsedSec - prevTime;
      speed = dt > 0 ? delta / dt : (point.speed ?? 0);
      // Teleport guard: a jump implying an implausible speed for this sport is
      // GPS noise (multipath, cold-fix snap), not movement. Drop the point so
      // distance and pace are not poisoned.
      if (activityType && dt > 0 && speed > getMaxPlausibleSpeed(activityType)) return;
      dist = prevDist + delta;
    } else {
      speed = point.speed ?? 0;
    }

    // Mutate the stream arrays in place to keep per-point cost O(1). A fresh
    // top-level `streams` object is still emitted so Zustand notifies
    // subscribers and downstream useMemo deps recompute; effects keyed on
    // `streams.x.length` fire because the length changes. Rebuilding all
    // arrays on every point was O(n) per call, O(n^2) per session.
    const { latestSensor } = get();
    const nowMs = Date.now();
    streams.time.push(elapsedSec);
    streams.latlng.push([point.latitude, point.longitude]);
    streams.altitude.push(point.altitude ?? 0);
    streams.speed.push(speed);
    streams.distance.push(dist);
    // Sensor streams stay index-aligned with time[] - sample-and-hold the
    // latest value per point, 0 (FIT no-data) when absent or stale.
    streams.heartrate.push(freshValue(latestSensor.heartrate, nowMs));
    streams.power.push(freshValue(latestSensor.power, nowMs));
    streams.cadence.push(freshValue(latestSensor.cadence, nowMs));
    set({ streams: { ...streams } });
  },

  setRawLocationFix: (fix) => {
    const { _lastRawFix } = get();
    let speed = fix.speed ?? null;
    if (_lastRawFix) {
      const dt = (fix.timestamp - _lastRawFix.timestamp) / 1000;
      if (dt <= 0) return;
      speed =
        haversineDistance(
          _lastRawFix.latitude,
          _lastRawFix.longitude,
          fix.latitude,
          fix.longitude
        ) / dt;
    }
    set({
      _lastRawFix: {
        latitude: fix.latitude,
        longitude: fix.longitude,
        timestamp: fix.timestamp,
      },
      rawSpeed: speed == null ? get().rawSpeed : { value: Math.max(speed, 0), at: fix.timestamp },
    });
  },

  setSensorSample: (kind, value) => {
    if (!Number.isFinite(value) || value < 0) return;
    set((state) => ({
      latestSensor: {
        ...state.latestSensor,
        [kind]: { value, at: Date.now() },
      },
    }));
  },

  addIndoorSample: () => {
    const { status, startTime, streams, latestSensor } = get();
    if (status !== 'recording' || !startTime) return;

    const nowMs = Date.now();
    const elapsedSec = (nowMs - startTime) / 1000;
    const lastTime = streams.time[streams.time.length - 1];
    if (lastTime !== undefined && elapsedSec <= lastTime) return;

    // No position for indoor samples - latlng stays shorter and the FIT
    // writer emits invalid-position sentinels for the missing indices.
    streams.time.push(elapsedSec);
    streams.altitude.push(0);
    streams.speed.push(0);
    streams.distance.push(streams.distance[streams.distance.length - 1] ?? 0);
    streams.heartrate.push(freshValue(latestSensor.heartrate, nowMs));
    streams.power.push(freshValue(latestSensor.power, nowMs));
    streams.cadence.push(freshValue(latestSensor.cadence, nowMs));
    set({ streams: { ...streams } });
  },

  addLap: () => {
    const { status, startTime, pausedDuration, streams, laps } = get();
    if (status !== 'recording' || !startTime) return;

    const now = Date.now();
    // Laps carry two clocks. startTime/endTime are wall clock so they index the
    // streams and the FIT lap timestamps; movingEndTime is the moving clock the
    // timer and the lap duration are measured on. Mixing them made lap distance
    // and average speed roughly double after any pause.
    const elapsed = (now - startTime) / 1000;
    const movingElapsed = (now - startTime - pausedDuration) / 1000;
    const lastLap = laps[laps.length - 1];
    const lapStart = lastLap ? lastLap.endTime : 0;
    const lapMovingStart = lastLap ? lastLap.movingEndTime : 0;

    const startIdx = lastLap ? lastLap.endIndex + 1 : 0;
    const endIdx = streams.time.length - 1;
    const hasSamples = endIdx >= startIdx;
    const slice = (arr: number[]): number[] => (hasSamples ? arr.slice(startIdx, endIdx + 1) : []);
    const hrSlice = slice(streams.heartrate);
    const pwrSlice = slice(streams.power);
    const cadSlice = slice(streams.cadence);

    const currentDist = streams.distance[endIdx] ?? 0;
    const startDist = startIdx > 0 ? (streams.distance[startIdx - 1] ?? 0) : 0;
    const lapDist = hasSamples ? currentDist - startDist : 0;
    const lapDuration = movingElapsed - lapMovingStart;

    const avg = (arr: number[]): number | null =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    const lap: RecordingLap = {
      index: laps.length,
      startTime: lapStart,
      endTime: elapsed,
      startIndex: startIdx,
      endIndex: endIdx,
      movingEndTime: movingElapsed,
      distance: lapDist,
      avgSpeed: lapDuration > 0 ? lapDist / lapDuration : 0,
      avgHeartrate: avg(hrSlice),
      avgPower: avg(pwrSlice),
      avgCadence: avg(cadSlice),
    };

    set({ laps: [...laps, lap] });
  },

  reset: () => {
    set({
      status: 'idle',
      activityType: null,
      mode: null,
      startTime: null,
      stopTime: null,
      pausedDuration: 0,
      pauseIntervals: [],
      streams: {
        time: [],
        latlng: [],
        altitude: [],
        heartrate: [],
        power: [],
        cadence: [],
        speed: [],
        distance: [],
      },
      laps: [],
      pairedEventId: null,
      latestSensor: { heartrate: null, power: null, cadence: null },
      rawSpeed: null,
      _lastRawFix: null,
      _pauseStart: null,
    });
  },
}));

/** Synchronous helper to get current recording status */
export function getRecordingStatus(): RecordingStatus {
  return useRecordingStore.getState().status;
}
