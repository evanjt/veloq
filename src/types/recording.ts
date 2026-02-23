import type { ActivityType } from './activity';

/** Recording mode determines the UI and data collection approach */
export type RecordingMode = 'gps' | 'indoor' | 'manual';

/** Overall recording lifecycle state */
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped' | 'saving';

/** GPS point collected during recording */
export interface RecordingGpsPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number; // Date.now()
}

/** Time-series streams accumulated during recording */
export interface RecordingStreams {
  time: number[]; // seconds since start
  latlng: [number, number][]; // [lat, lng]
  altitude: number[]; // meters
  heartrate: number[]; // bpm
  power: number[]; // watts
  cadence: number[]; // rpm
  speed: number[]; // m/s
  distance: number[]; // cumulative meters
}

/** A lap marker during recording */
export interface RecordingLap {
  index: number;
  startTime: number; // seconds since activity start
  endTime: number; // seconds since activity start
  distance: number; // meters
  avgSpeed: number; // m/s
  avgHeartrate: number | null;
  avgPower: number | null;
  avgCadence: number | null;
}

/** BLE sensor info */
export interface SensorInfo {
  id: string;
  name: string;
  type: 'heartrate' | 'power' | 'cadence' | 'speed';
  connected: boolean;
}

/** Manual activity entry data */
export interface ManualActivityData {
  type: ActivityType;
  name: string;
  start_date_local: string; // ISO date
  elapsed_time: number; // seconds
  moving_time?: number;
  distance?: number; // meters
  total_elevation_gain?: number;
  average_heartrate?: number;
  description?: string;
  trainer?: boolean;
  commute?: boolean;
}

/** Response from intervals.icu file upload */
export interface UploadResponse {
  id: string;
  name: string;
  type: string;
  start_date_local: string;
}

/** intervals.icu calendar event (planned workout) */
export interface CalendarEvent {
  id: number;
  uid: string;
  name: string;
  start_date_local: string;
  type: ActivityType;
  category: string;
  description?: string;
  indoor?: boolean;
  color?: string;
  moving_time?: number;
  icu_training_load?: number;
  workout_doc?: WorkoutDoc;
}

/** Structured workout document */
export interface WorkoutDoc {
  steps: WorkoutStep[];
  duration?: number; // total planned seconds
  zoneTimes?: Record<string, number>;
}

/** Individual workout step */
export interface WorkoutStep {
  type: 'warmup' | 'work' | 'recovery' | 'rest' | 'cooldown' | 'ramp';
  duration?: number; // seconds (time-based)
  distance?: number; // meters (distance-based)
  power?: WorkoutTarget;
  hr?: WorkoutTarget;
  cadence?: WorkoutTarget;
  pace?: WorkoutTarget;
  reps?: number; // for repeat steps
  steps?: WorkoutStep[]; // nested steps in repeat
}

/** Target range for a workout step */
export interface WorkoutTarget {
  min: number;
  max: number;
  units: 'absolute' | 'percentFtp' | 'percentLthr' | 'percentThresholdPace';
}

/** Upload queue entry for offline sync */
export interface UploadQueueEntry {
  id: string; // UUID
  filePath: string;
  activityType: ActivityType;
  name: string;
  pairedEventId?: number;
  createdAt: number; // Date.now()
  retryCount: number;
  lastError?: string;
}

/** Crash recovery backup */
export interface RecordingBackup {
  activityType: ActivityType;
  mode: RecordingMode;
  startTime: number;
  pausedDuration: number;
  streams: RecordingStreams;
  laps: RecordingLap[];
  pairedEventId: number | null;
  savedAt: number; // Date.now()
}

/** Data field display configuration */
export type DataFieldType =
  | 'speed'
  | 'avgSpeed'
  | 'distance'
  | 'heartrate'
  | 'power'
  | 'cadence'
  | 'elevation'
  | 'elevationGain'
  | 'pace'
  | 'avgPace'
  | 'timer'
  | 'movingTime'
  | 'lapTime'
  | 'lapDistance'
  | 'calories';
