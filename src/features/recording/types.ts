import type { ActivityType } from '@/features/activity';

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
  altitude: number[]; // metres; NaN when the fix has no altitude
  heartrate: number[]; // bpm
  power: number[]; // watts
  cadence: number[]; // rpm
  speed: number[]; // m/s
  distance: number[]; // cumulative meters
}

/** A lap marker during recording */
export interface RecordingLap {
  index: number;
  startTime: number; // wall-clock seconds since activity start, same base as streams.time
  endTime: number; // wall-clock seconds since activity start, same base as streams.time
  startIndex: number; // first stream sample in the lap
  endIndex: number; // last stream sample in the lap, -1 when the lap has no samples
  movingEndTime: number; // cumulative moving seconds at the lap press
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
  moving_time?: number | undefined;
  distance?: number | undefined; // meters
  total_elevation_gain?: number | undefined;
  average_heartrate?: number | undefined;
  description?: string | undefined;
  trainer?: boolean | undefined;
  commute?: boolean | undefined;
}

export type RecordingUploadStatus =
  | 'localOnly'
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'permissionBlocked';

/** What a recording holds: a FIT this device wrote, or a body the athlete typed. */
export type RecordingKind = 'fit' | 'manual';

/** A recording saved permanently on device (FIT file + metadata + streams sidecar) */
export interface RecordingLibraryEntry {
  id: string;
  /**
   * `fit` for a recorded ride, `manual` for an indoor entry typed into the app.
   * A manual entry has no file: `fitPath` is empty and the request body sits
   * where the streams sidecar would.
   */
  kind: RecordingKind;
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
  /** The engine key the recording was written under at save time. */
  engineActivityId?: string;
  /** Whether the engine row carries the id intervals.icu gave the upload. */
  engineReconciled?: boolean;
  /**
   * The athlete signed in when the recording was saved. Absent on an entry
   * saved before the stamp existed, or with nobody signed in, and an absent
   * stamp is never treated as a match: the entry is held rather than uploaded.
   */
  athleteId?: string;
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
  /** Pauses as elapsed seconds since startTime. Older backups carry none. */
  pauseIntervals?: { start: number; end: number }[];
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
