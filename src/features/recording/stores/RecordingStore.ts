import { haversineDistance } from '@/shared/geo/distance';
import { elevationGain } from '@/shared/math/kinematics';
import { create } from 'zustand';

import { getMaxPlausibleSpeed } from '@/shared/recording/sportCategoryDetector';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { PauseInterval } from '@/features/recording/lib/pausedTime';
import { getRecordingMode } from '@/features/recording/lib/recordingModes';
import { summariseLap } from '@/features/recording/lib/savedLaps';
import {
  advance,
  remainingMetres,
  remainingSeconds,
  startFollow,
  syncFollow,
  type FollowState,
  type PlanLine,
  type WorkoutFollow,
} from '@/features/recording/lib/planFollow';
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

export function freshValue(sample: SensorSampleLite | null, now: number): number {
  if (!sample) return 0;
  return now - sample.at <= SENSOR_STALE_MS ? sample.value : 0;
}

/**
 * What the live metrics need that a single sample cannot answer.
 *
 * The metrics hook used to rescan the whole altitude and heart-rate arrays on
 * every fix, so a five-hour ride at 1 Hz walked 18,000 entries three times a
 * second and the work over the ride was quadratic. These are kept per appended
 * sample instead, which is O(1) each, and the hook reads them.
 */
export interface RecordingTotals {
  /** Sum of the positive altitude deltas, in metres. */
  elevationGain: number;
  /** Last finite altitude, retained across samples with no reading. */
  lastAltitude: number | null;
  /** Sum of the heart-rate samples that carried a reading. */
  heartrateSum: number;
  /** How many of them did. */
  heartrateCount: number;
}

const EMPTY_TOTALS: RecordingTotals = {
  elevationGain: 0,
  lastAltitude: null,
  heartrateSum: 0,
  heartrateCount: 0,
};

/**
 * Scan a whole stream back into its totals.
 *
 * The crash restore sets the streams wholesale rather than appending them, so
 * that one path pays the scan once instead of accumulating.
 */
export function streamTotals(streams: RecordingStreams): RecordingTotals {
  let lastAltitude: number | null = null;
  for (const altitude of streams.altitude) {
    if (Number.isFinite(altitude)) lastAltitude = altitude;
  }
  let heartrateSum = 0;
  let heartrateCount = 0;
  for (const hr of streams.heartrate) {
    if (hr > 0) {
      heartrateSum += hr;
      heartrateCount += 1;
    }
  }
  return {
    elevationGain: elevationGain(streams.altitude),
    lastAltitude,
    heartrateSum,
    heartrateCount,
  };
}

function lastPositioned(latlng: [number, number][]): [number, number] | undefined {
  for (let i = latlng.length - 1; i >= 0; i--) {
    if (latlng[i][0] !== 0 || latlng[i][1] !== 0) return latlng[i];
  }
  return undefined;
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
  athleteId: string | null;
  activityType: ActivityType | null;
  mode: RecordingMode | null;
  startTime: number | null;
  stopTime: number | null;
  pausedDuration: number;
  /** Each pause as elapsed seconds since startTime, so any stream window can subtract its own. */
  pauseIntervals: PauseInterval[];
  streams: RecordingStreams;
  /** Kept per appended sample; `streamTotals` rebuilds them for a restore. */
  totals: RecordingTotals;
  laps: RecordingLap[];
  pairedEventId: number | null;
  /**
   * The planned workout this recording follows, frozen at the start so a
   * calendar refresh never moves it, with the progress through it on the
   * moving clock. Null for a recording with no plan.
   */
  workout: WorkoutFollow | null;
  /**
   * The library holds this session. A saved ride can still sit here behind the
   * review screen's toast, and a sign-out or sign-in never holds or reopens it.
   */
  savedToLibrary: boolean;
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
  /**
   * Follow a planned workout from here. Called once, as the recording starts,
   * with the plan frozen for the session; an empty plan follows nothing.
   */
  followWorkout: (plan: { name: string; lines: readonly PlanLine[] } | null) => void;
  /** The athlete moved on to the next step of the plan. */
  advanceWorkout: () => void;
  /** `at` is when the pause began, for a pause decided from fixes taken earlier. */
  pauseRecording: (at?: number) => void;
  /** `at` is when the ride moved again, for a resume decided from fixes taken earlier. */
  resumeRecording: (at?: number) => void;
  stopRecording: () => void;
  /**
   * Take a stopped, unsaved ride back to a paused recording. The time since the
   * stop is a pause, so the moving clock reads what it read at the stop.
   */
  reopenStoppedRecording: () => void;
  changeActivityType: (type: ActivityType) => void;
  addGpsPoint: (point: RecordingGpsPoint) => void;
  setRawLocationFix: (fix: RecordingGpsPoint) => void;
  setSensorSample: (kind: SensorStreamKind, value: number) => void;
  /** Indoor mode has no GPS points; a 1 Hz tick appends aligned sensor samples instead. */
  addIndoorSample: () => void;
  addLap: () => void;
  /** Mark the session saved, only while the store still holds that athlete's ride. */
  markSavedToLibrary: (athleteId: string, startTime: number) => void;
  reset: () => void;
}

type ClockState = Pick<
  RecordingState,
  'status' | 'startTime' | 'pausedDuration' | '_pauseStart'
> & {
  stopTime?: number | null;
};

/**
 * The distance a plan's distance steps are measured on: what GPS recorded, and
 * none indoors, where nothing records distance and a step must not finish on a
 * number that never moves.
 */
function recordedDistance(state: Pick<RecordingState, 'mode' | 'streams'>): number | null {
  if (state.mode !== 'gps') return null;
  return state.streams.distance[state.streams.distance.length - 1] ?? 0;
}

/**
 * Paused milliseconds up to `now`. The store closes a pause only on resume, so
 * a surface drawn mid-pause has to add the pause it is standing in.
 */
export function pausedMsAt(state: ClockState, now: number): number {
  const { status, pausedDuration, _pauseStart } = state;
  if (status !== 'paused' || !_pauseStart) return pausedDuration;
  return pausedDuration + Math.max(0, now - _pauseStart);
}

/** Moving milliseconds up to `now`, the one clock the screen, notification and Live Activity show. */
export function movingMsAt(state: ClockState, now: number): number {
  const { status, startTime } = state;
  if (!startTime || status === 'idle') return 0;
  const end = status === 'stopped' ? (state.stopTime ?? now) : now;
  return Math.max(0, end - startTime - pausedMsAt(state, end));
}

type WorkoutClockState = ClockState & Pick<RecordingState, 'workout' | 'mode' | 'streams'>;

/** The followed plan brought up to `now`, or the same object when nothing moved. */
function syncedWorkout(state: WorkoutClockState, now: number): WorkoutFollow | null {
  const { workout } = state;
  if (!workout) return null;
  const follow = syncFollow(workout.follow, movingMsAt(state, now), recordedDistance(state));
  return follow === workout.follow ? workout : { ...workout, follow };
}

export interface WorkoutView {
  name: string;
  follow: FollowState;
  remainingSeconds: number | null;
  remainingMetres: number | null;
}

/**
 * The followed plan as the screen shows it at `now`. Every surface reads it
 * through here, so the countdown and the step the store advances to on the
 * next sample are the same arithmetic.
 */
export function workoutAt(state: WorkoutClockState, now: number): WorkoutView | null {
  const workout = syncedWorkout(state, now);
  if (!workout) return null;
  const clock = movingMsAt(state, now);
  const distance = recordedDistance(state);
  return {
    name: workout.name,
    follow: workout.follow,
    remainingSeconds: remainingSeconds(workout.follow, clock),
    remainingMetres: remainingMetres(workout.follow, distance),
  };
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

/** A pause or resume at `at`, held between `floor` and the present; now when `at` is absent. */
function clampStamp(at: number | undefined, floor: number): number {
  const now = Date.now();
  if (at === undefined) return now;
  return Math.min(now, Math.max(floor, at));
}

/** One appended sample's contribution, the same arithmetic `streamTotals` does. */
function accumulate(totals: RecordingTotals, altitude: number, heartrate: number): RecordingTotals {
  const valid = Number.isFinite(altitude);
  const previous = totals.lastAltitude;
  const climb = valid && previous !== null && altitude > previous ? altitude - previous : 0;
  return {
    elevationGain: totals.elevationGain + climb,
    lastAltitude: valid ? altitude : previous,
    heartrateSum: heartrate > 0 ? totals.heartrateSum + heartrate : totals.heartrateSum,
    heartrateCount: heartrate > 0 ? totals.heartrateCount + 1 : totals.heartrateCount,
  };
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  status: 'idle',
  athleteId: null,
  activityType: null,
  mode: null,
  startTime: null,
  stopTime: null,
  pausedDuration: 0,
  pauseIntervals: [],
  streams: { ...EMPTY_STREAMS },
  totals: { ...EMPTY_TOTALS },
  laps: [],
  pairedEventId: null,
  workout: null,
  savedToLibrary: false,
  latestSensor: { heartrate: null, power: null, cadence: null },
  rawSpeed: null,
  _lastRawFix: null,
  _pauseStart: null,

  startRecording: (type, mode, pairedEventId) => {
    set({
      status: 'recording',
      athleteId: useAuthStore.getState().athleteId,
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
      totals: { ...EMPTY_TOTALS },
      laps: [],
      pairedEventId: pairedEventId ?? null,
      workout: null,
      savedToLibrary: false,
      latestSensor: { heartrate: null, power: null, cadence: null },
      rawSpeed: null,
      _lastRawFix: null,
      _pauseStart: null,
    });
  },

  followWorkout: (plan) => {
    const state = get();
    if (state.status !== 'recording' && state.status !== 'paused') return;
    if (!plan || plan.lines.length === 0) {
      set({ workout: null });
      return;
    }
    const follow = startFollow(plan.lines, movingMsAt(state, Date.now()), recordedDistance(state));
    set({ workout: { name: plan.name, follow } });
  },

  advanceWorkout: () => {
    const state = get();
    if (state.status !== 'recording' && state.status !== 'paused') return;
    const now = Date.now();
    const workout = syncedWorkout(state, now);
    if (!workout) return;
    const follow = advance(workout.follow, movingMsAt(state, now), recordedDistance(state));
    set({ workout: { ...workout, follow } });
  },

  pauseRecording: (at) => {
    const { status, startTime, pauseIntervals } = get();
    if (status !== 'recording') return;
    // A pause never opens before the ride started or the last pause closed,
    // nor after the moment it is taken.
    const lastEnd = pauseIntervals.at(-1)?.end;
    const floor =
      startTime && lastEnd !== undefined ? startTime + lastEnd * 1000 : (startTime ?? -Infinity);
    set({ status: 'paused', _pauseStart: clampStamp(at, floor) });
  },

  resumeRecording: (at) => {
    const { status, _pauseStart, pausedDuration, pauseIntervals, startTime } = get();
    if (status !== 'paused') return;
    const now = clampStamp(at, _pauseStart ?? -Infinity);
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
    const pausedSince = status === 'paused' ? _pauseStart : null;
    set({
      status: 'stopped',
      stopTime: now,
      pausedDuration: pausedDuration + (pausedSince ? now - pausedSince : 0),
      pauseIntervals: closePause(pauseIntervals, startTime, pausedSince, now),
      _pauseStart: null,
    });
  },

  reopenStoppedRecording: () => {
    const { status, savedToLibrary, stopTime, startTime, pausedDuration, pauseIntervals } = get();
    if (status !== 'stopped' || savedToLibrary || !stopTime) return;
    const now = Date.now();
    set({
      status: 'paused',
      stopTime: null,
      pausedDuration: pausedDuration + (now - stopTime),
      pauseIntervals: closePause(pauseIntervals, startTime, stopTime, now),
      _pauseStart: now,
    });
  },

  // Idle is every moment before a start, including a one-tap entry waiting on
  // its Start button. A finished recording is `stopped`, not idle, so the
  // guard that used to sit here never protected one: it only refused the sport
  // change the athlete most needs, the one that fixes a wrong tap.
  //
  // Once started, the recording mode follows the sport so the session's location
  // watch or indoor sampler matches it. Samples already recorded are kept.
  changeActivityType: (type) => {
    if (get().status === 'idle') {
      set({ activityType: type });
      return;
    }
    set({ activityType: type, mode: getRecordingMode(type) });
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

    // Samples taken indoors carry no position. Pad them with the FIT no-position
    // sentinel so this fix lands at its own index in the time-aligned streams.
    while (streams.latlng.length < streams.time.length) streams.latlng.push([0, 0]);
    const prevLatlng = lastPositioned(streams.latlng);
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
    const { latestSensor, totals } = get();
    const nowMs = Date.now();
    const altitude = point.altitude ?? NaN;
    const heartrate = freshValue(latestSensor.heartrate, nowMs);
    streams.time.push(elapsedSec);
    streams.latlng.push([point.latitude, point.longitude]);
    streams.altitude.push(altitude);
    streams.speed.push(speed);
    streams.distance.push(dist);
    // Sensor streams stay index-aligned with time[] - sample-and-hold the
    // latest value per point, 0 (FIT no-data) when absent or stale.
    streams.heartrate.push(heartrate);
    streams.power.push(freshValue(latestSensor.power, nowMs));
    streams.cadence.push(freshValue(latestSensor.cadence, nowMs));
    set({
      streams: { ...streams },
      totals: accumulate(totals, altitude, heartrate),
      // Each fix moves the plan on at its own time, so a distance step ends on
      // the fix that covered it, in the foreground or in a background batch.
      workout: syncedWorkout(get(), point.timestamp),
    });
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
    const heartrate = freshValue(latestSensor.heartrate, nowMs);
    streams.time.push(elapsedSec);
    streams.altitude.push(NaN);
    streams.speed.push(0);
    streams.distance.push(streams.distance[streams.distance.length - 1] ?? 0);
    streams.heartrate.push(heartrate);
    streams.power.push(freshValue(latestSensor.power, nowMs));
    streams.cadence.push(freshValue(latestSensor.cadence, nowMs));
    set({
      streams: { ...streams },
      totals: accumulate(get().totals, NaN, heartrate),
      workout: syncedWorkout(get(), nowMs),
    });
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

    const lap = summariseLap(
      streams,
      {
        index: laps.length,
        startTime: lapStart,
        endTime: elapsed,
        startIndex: lastLap ? lastLap.endIndex + 1 : 0,
        endIndex: streams.time.length - 1,
        movingEndTime: movingElapsed,
      },
      lapMovingStart
    );

    set({ laps: [...laps, lap] });
  },

  markSavedToLibrary: (athleteId, startTime) => {
    const { athleteId: owner, startTime: start, status } = get();
    if (status === 'idle' || owner !== athleteId || start !== startTime) return;
    set({ savedToLibrary: true });
  },

  reset: () => {
    set({
      status: 'idle',
      athleteId: null,
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
      totals: { ...EMPTY_TOTALS },
      laps: [],
      pairedEventId: null,
      workout: null,
      savedToLibrary: false,
      latestSensor: { heartrate: null, power: null, cadence: null },
      rawSpeed: null,
      _lastRawFix: null,
      _pauseStart: null,
    });
  },
}));
