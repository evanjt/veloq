import { create } from 'zustand';

import { getMaxPlausibleSpeed } from '@/features/recording/lib/sportCategoryDetector';
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

/** Haversine distance between two GPS points in meters */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface RecordingState {
  status: RecordingStatus;
  activityType: ActivityType | null;
  mode: RecordingMode | null;
  startTime: number | null;
  stopTime: number | null;
  pausedDuration: number;
  streams: RecordingStreams;
  laps: RecordingLap[];
  pairedEventId: number | null;
  /** Sample-and-hold of the latest sensor values, written by the sensors feature. */
  latestSensor: Record<SensorStreamKind, SensorSampleLite | null>;
  // Internal: track pause start for duration accumulation
  _pauseStart: number | null;
  // Actions
  startRecording: (type: ActivityType, mode: RecordingMode, pairedEventId?: number) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  changeActivityType: (type: ActivityType) => void;
  addGpsPoint: (point: RecordingGpsPoint) => void;
  setSensorSample: (kind: SensorStreamKind, value: number) => void;
  /** Indoor mode has no GPS points; a 1 Hz tick appends aligned sensor samples instead. */
  addIndoorSample: () => void;
  addLap: () => void;
  reset: () => void;
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  status: 'idle',
  activityType: null,
  mode: null,
  startTime: null,
  stopTime: null,
  pausedDuration: 0,
  streams: { ...EMPTY_STREAMS },
  laps: [],
  pairedEventId: null,
  latestSensor: { heartrate: null, power: null, cadence: null },
  _pauseStart: null,

  startRecording: (type, mode, pairedEventId) => {
    set({
      status: 'recording',
      activityType: type,
      mode,
      startTime: Date.now(),
      pausedDuration: 0,
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
      _pauseStart: null,
    });
  },

  pauseRecording: () => {
    const { status } = get();
    if (status !== 'recording') return;
    set({ status: 'paused', _pauseStart: Date.now() });
  },

  resumeRecording: () => {
    const { status, _pauseStart, pausedDuration } = get();
    if (status !== 'paused') return;
    const additionalPause = _pauseStart ? Date.now() - _pauseStart : 0;
    set({
      status: 'recording',
      pausedDuration: pausedDuration + additionalPause,
      _pauseStart: null,
    });
  },

  stopRecording: () => {
    const { status, _pauseStart, pausedDuration } = get();
    if (status !== 'recording' && status !== 'paused') return;
    const additionalPause = status === 'paused' && _pauseStart ? Date.now() - _pauseStart : 0;
    set({
      status: 'stopped',
      stopTime: Date.now(),
      pausedDuration: pausedDuration + additionalPause,
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

  setSensorSample: (kind, value) => {
    if (!Number.isFinite(value) || value < 0) return;
    set((state) => ({
      latestSensor: { ...state.latestSensor, [kind]: { value, at: Date.now() } },
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
    const currentElapsed = (now - startTime - pausedDuration) / 1000;
    const lastLap = laps[laps.length - 1];
    const lapStart = lastLap ? lastLap.endTime : 0;

    // Calculate lap metrics from streams
    const lapStartIdx = streams.time.findIndex((t) => t >= lapStart);
    const hrSlice = lapStartIdx >= 0 ? streams.heartrate.slice(lapStartIdx) : [];
    const pwrSlice = lapStartIdx >= 0 ? streams.power.slice(lapStartIdx) : [];
    const cadSlice = lapStartIdx >= 0 ? streams.cadence.slice(lapStartIdx) : [];
    const currentDist = streams.distance[streams.distance.length - 1] ?? 0;
    const startDist = lapStartIdx >= 0 ? (streams.distance[lapStartIdx] ?? 0) : 0;
    const lapDist = currentDist - startDist;
    const lapDuration = currentElapsed - lapStart;

    const avg = (arr: number[]): number | null =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    const lap: RecordingLap = {
      index: laps.length,
      startTime: lapStart,
      endTime: currentElapsed,
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
      _pauseStart: null,
    });
  },
}));

/** Synchronous helper to get current recording status */
export function getRecordingStatus(): RecordingStatus {
  return useRecordingStore.getState().status;
}
