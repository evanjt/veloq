import type { ActivityType } from '@/features/activity/types';

/** Recording mode determines the UI and data collection approach */
export type RecordingMode = 'gps' | 'indoor' | 'manual';

/** Overall recording lifecycle state */
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped';

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

/** Target range for a workout step */
export interface WorkoutTarget {
  min: number;
  max: number;
  units: 'absolute' | 'percentFtp' | 'percentLthr' | 'percentThresholdPace';
}

/**
 * Upload lifecycle of a locally saved recording.
 * - localOnly: saved on device, auto-upload off or user opted out
 * - pending: waiting for (re)upload, eligible per backoff
 * - uploading: upload in flight
 * - uploaded: on intervals.icu; local copy kept
 * - failed: exhausted automatic retries or rejected by the server; manual retry only
 * - permissionBlocked: needs OAuth ACTIVITY:WRITE before it can upload
 */
export type RecordingUploadStatus =
  | 'localOnly'
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'permissionBlocked';

/** A recording saved permanently on device (FIT file + metadata + streams sidecar) */
export interface RecordingLibraryEntry {
  id: string;
  fitPath: string;
  streamsPath?: string;
  activityType: ActivityType;
  name: string;
  startTime: number; // ms epoch
  durationSeconds: number;
  distanceMeters: number;
  elevationGain?: number;
  avgHeartrate?: number | null;
  pairedEventId?: number;
  createdAt: number; // Date.now()
  uploadStatus: RecordingUploadStatus;
  retryCount: number;
  lastAttemptAt?: number;
  lastError?: string;
  intervalsActivityId?: string;
}

/** Crash recovery backup */
export interface RecordingBackup {
  activityType: ActivityType;
  mode: RecordingMode;
  /** Session state at save time. A 'stopped' backup restores to the review screen. */
  status: 'recording' | 'paused' | 'stopped';
  startTime: number;
  stopTime: number | null;
  /** Includes any in-progress pause up to savedAt, so restore only credits savedAt→now. */
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
