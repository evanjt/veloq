import { create } from 'zustand';
import type {
  ActivityType,
  RecordingMode,
  RecordingStatus,
  RecordingStreams,
  RecordingGpsPoint,
  RecordingLap,
  SensorInfo,
} from '@/types';

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
  connectedSensors: SensorInfo[];
  // Internal: track pause start for duration accumulation
  _pauseStart: number | null;
  // Future: route/section guidance
  guidanceSection: { id: string; polyline: [number, number][] } | null;
  guidanceRoute: { id: string; polyline: [number, number][] } | null;
  // Actions
  startRecording: (type: ActivityType, mode: RecordingMode, pairedEventId?: number) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  changeActivityType: (type: ActivityType) => void;
  addGpsPoint: (point: RecordingGpsPoint) => void;
  addHeartrate: (bpm: number, time: number) => void;
  addPower: (watts: number, time: number) => void;
  addCadence: (rpm: number, time: number) => void;
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
  connectedSensors: [],
  _pauseStart: null,
  guidanceSection: null,
  guidanceRoute: null,

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
      connectedSensors: [],
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
    const { status, startTime, streams } = get();
    if (status !== 'recording' || !startTime) return;

    const elapsedSec = (point.timestamp - startTime) / 1000;
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
      dist = prevDist + delta;
      const prevTime = streams.time[streams.time.length - 1] ?? 0;
      const dt = elapsedSec - prevTime;
      speed = dt > 0 ? delta / dt : (point.speed ?? 0);
    } else {
      speed = point.speed ?? 0;
    }

    set({
      streams: {
        ...streams,
        time: [...streams.time, elapsedSec],
        latlng: [...streams.latlng, [point.latitude, point.longitude]],
        altitude: [...streams.altitude, point.altitude ?? 0],
        speed: [...streams.speed, speed],
        distance: [...streams.distance, dist],
        heartrate: streams.heartrate,
        power: streams.power,
        cadence: streams.cadence,
      },
    });
  },

  addHeartrate: (bpm, time) => {
    const { status, startTime, streams } = get();
    if (status !== 'recording' || !startTime) return;
    set({
      streams: {
        ...streams,
        heartrate: [...streams.heartrate, bpm],
      },
    });
  },

  addPower: (watts, time) => {
    const { status, startTime, streams } = get();
    if (status !== 'recording' || !startTime) return;
    set({
      streams: {
        ...streams,
        power: [...streams.power, watts],
      },
    });
  },

  addCadence: (rpm, time) => {
    const { status, startTime, streams } = get();
    if (status !== 'recording' || !startTime) return;
    set({
      streams: {
        ...streams,
        cadence: [...streams.cadence, rpm],
      },
    });
  },

  addLap: () => {
    const { status, startTime, pausedDuration, streams, laps } = get();
    if (status !== 'recording' || !startTime) return;

    const now = Date.now();
    const currentElapsed = (now - startTime - pausedDuration) / 1000;
    const lastLap = laps[laps.length - 1];
    const lapStart = lastLap ? lastLap.endTime : 0;
    const lapStartDist = lastLap
      ? lastLap.distance +
        (laps.length > 1 ? laps.slice(0, -1).reduce((s, l) => s + l.distance, 0) : 0)
      : 0;

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
      connectedSensors: [],
      _pauseStart: null,
      guidanceSection: null,
      guidanceRoute: null,
    });
  },
}));

/** Synchronous helper to get current recording status */
export function getRecordingStatus(): RecordingStatus {
  return useRecordingStore.getState().status;
}
