import type { ActivityType } from '@/shared/native/sportTaxonomy.generated';

export type { ActivityType };

export interface Activity {
  id: string;
  name: string;
  type: ActivityType;
  start_date_local: string;
  moving_time: number;
  elapsed_time: number;
  distance: number;
  total_elevation_gain: number;
  // Heart rate
  average_heartrate?: number | undefined;
  max_heartrate?: number | undefined;
  // Power
  icu_average_watts?: number | undefined;
  icu_pm_p_max?: number | undefined;
  average_speed: number;
  max_speed: number;
  average_cadence?: number | undefined;
  calories?: number | undefined;
  pacing_index?: number | undefined; // Aerobic decoupling metric
  start_latlng?: [number, number] | undefined;
  end_latlng?: [number, number] | undefined;
  // Stream types available for this activity
  stream_types?: string[] | undefined;
  // Zone time distributions
  // icu_zone_times is array of {id: 'Z1', secs: 123} objects (power zones)
  icu_zone_times?: { id: string; secs: number }[] | undefined;
  // icu_hr_zone_times is flat array of seconds per HR zone
  icu_hr_zone_times?: number[] | undefined;
  // Zone thresholds
  icu_power_zones?: number[] | undefined; // percent of icu_ftp, 999 for the open top
  icu_hr_zones?: number[] | undefined;
  // Training metrics
  icu_training_load?: number | undefined; // training load
  icu_ftp?: number | undefined; // FTP used for this activity
  icu_rolling_ftp?: number | undefined; // eFTP intervals.icu accepted after this activity
  icu_rolling_ftp_delta?: number | undefined; // Change this activity made to it, zero or absent when none
  // Weather data (when available from intervals.icu)
  has_weather?: boolean | undefined;
  average_weather_temp?: number | undefined; // Temperature in Celsius
  average_weather_wind_speed?: number | undefined; // Deprecated: use average_wind_speed
  average_wind_gust?: number | undefined; // Wind gust in m/s
  average_clouds?: number | undefined; // Cloud cover percentage
  average_weather_humidity?: number | undefined; // Humidity percentage
  // Skyline chart - compact protobuf encoding of interval zones/durations
  skyline_chart_bytes?: string | undefined;
  /**
   * Not from intervals.icu: the id a web link to intervals.icu may name, as the
   * engine's feed read answers it. Null for a demo row and for a recording no
   * server has named, absent on a body not read through the feed.
   */
  intervalsWebId?: string | null | undefined;
}

// Processed streams in a usable format
export interface ActivityStreams {
  time?: Float64Array;
  /** Latitude and longitude in alternate slots, two a sample. */
  latlng?: Float64Array;
  altitude?: Float64Array;
  heartrate?: Float64Array;
  watts?: Float64Array;
  cadence?: Float64Array;
  velocity_smooth?: Float64Array;
  distance?: Float64Array;
  grade_smooth?: Float64Array;
  temp?: Float64Array;
  /** W' balance stream in joules remaining. Sourced from intervals.icu's
   * `w_bal` stream. Only populated when the server has computed it (power +
   * FTP + W'). */
  wbal?: Float64Array;
  /** Grade-Adjusted Pace in min/km. Converted from intervals.icu's
   * `ga_velocity` stream (m/s) at parse time. */
  gap?: Float64Array;
}

/** One lap of an activity, typed by the engine from the stored interval body. */
export type { ActivityInterval } from 'veloqrs';

/** The stored intervals.icu athlete profile, typed by the engine. */
export type { AthleteProfile as Athlete } from 'veloqrs';

/**
 * One stored wellness day, as the screens read it.
 *
 * Exactly what `toWellnessData` writes out of the engine's typed day, and so
 * exactly what a screen can find on one. The intervals.icu body carries far
 * more (`ApiWellness` in `demo/types.ts` is its shape), and a field wanted here
 * later arrives with a column and an `FfiWellnessDay` field rather than as an
 * `undefined` a reader has to discover.
 */
export interface WellnessData {
  id: string; // ISO-8601 date (YYYY-MM-DD)
  ctl?: number | undefined; // Chronic Training Load (Fitness) - 42 day avg
  atl?: number | undefined; // Acute Training Load (Fatigue) - 7 day avg
  rampRate?: number | undefined; // Rate of fitness change
  sportInfo?: SportLoadInfo[] | undefined; // Per-sport breakdown
  weight?: number | undefined;
  restingHR?: number | undefined;
  hrv?: number | undefined;
  sleepSecs?: number | undefined;
  sleepScore?: number | undefined;
  soreness?: number | undefined;
  fatigue?: number | undefined;
  stress?: number | undefined;
  mood?: number | undefined;
  motivation?: number | undefined;
}

export interface SportLoadInfo {
  eftp?: number | undefined;
  sportGroup?: string | undefined;
  types?: string[] | undefined;
  ctl?: number | undefined;
  atl?: number | undefined;
  load?: number | undefined;
  dayCount?: number | undefined;
}

/** One of the server's fitted critical-power models for a curve window. */
export interface PowerModel {
  /** `MS_2P`, `MORTON_3P`, `FFT_CURVES` or `ECP`. */
  type: string;
  criticalPower: number;
  /** W prime, joules above critical power. */
  wPrime: number;
  ftp: number;
  /** The three-parameter models' peak, absent on the two-parameter fit. */
  pMax?: number;
}

/** An activity a curve point came from, as the body names it. */
export interface CurveActivity {
  id: string;
  name: string;
  distance: number;
  movingTime: number;
  trainingLoad: number;
  weight: number;
  startDateLocal: string;
  race: boolean;
}

/**
 * A power curve for one sport and window, as the body carries it. The body
 * is stored whole in Rust, so what is not lifted here is not lost, only
 * unread until a reader wants it.
 */
export interface PowerCurve {
  type: 'power';
  sport: string;
  secs: number[]; // Array of durations
  watts: number[]; // Best watts for each duration
  watts_per_kg?: number[] | undefined; // Best w/kg for each duration
  activity_ids?: string[] | undefined; // Activity IDs for each best
  /** Activity ids for each per-kilogram best, which need not be the watts one. */
  wkg_activity_ids?: string[] | undefined;
  /** The athlete's weight the per-kilogram series was divided by. */
  weight?: number | undefined;
  /** The server's fitted models, in the order it sent them. */
  models?: PowerModel[] | undefined;
  /** Every activity a point came from, so a checkpoint has a date offline. */
  activities?: Record<string, CurveActivity> | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  days?: number | undefined;
}

// Pace curve response (for running)
export interface PaceCurve {
  type: 'pace';
  sport: string;
  distances: number[]; // Array of distances in meters
  times: number[]; // Array of times in seconds to cover each distance
  pace: number[]; // Pace in m/s at each distance (distance/time)
  activity_ids?: string[] | undefined;
  /** Every activity a point came from. */
  activities?: Record<string, CurveActivity> | undefined;
  // Critical Speed model data
  criticalSpeed?: number | undefined; // Critical speed from pace model (m/s) - use as threshold pace
  dPrime?: number | undefined; // D' (anaerobic distance capacity) in meters
  r2?: number | undefined; // R² (model fit quality)
  // Date range
  startDate?: string | undefined; // Start date of the curve period (ISO string)
  endDate?: string | undefined; // End date of the curve period (ISO string)
  days?: number | undefined; // Number of days in the period
}

// Zone distribution for a time period
export interface ZoneDistribution {
  zone: number;
  name: string;
  seconds: number; // Time in this zone
  share: number; // The engine's whole-percent share of the time, the zones totalling 100
}

// Activity bounds for regional map
export interface ActivityBoundsItem {
  id: string;
  bounds: [[number, number], [number, number]]; // [[minLat, minLng], [maxLat, maxLng]]
  type: ActivityType;
  name: string;
  date: string; // ISO date
  distance: number; // meters
  duration: number; // seconds
  /**
   * Where the ride began, `[lat, lng]`, from the engine's own signature record.
   * The map marker belongs here rather than at the centre of the bounding box,
   * and having it on the first read is what stops every marker being uploaded
   * once on its bounds centre and again once the signatures finish loading.
   * Absent for an activity the engine holds no signature for.
   */
  startPoint?: [number, number] | undefined;
  /** Recorded in a simulated world, so its track is not where the athlete rides. */
  isVirtual?: boolean;
}

export interface ActivityMapData {
  bounds: [[number, number], [number, number]] | null;
  latlngs: ([number, number] | null)[] | null;
  route: unknown | null;
  weather: unknown | null;
}

// Athlete summary for a week (from /athlete-summary endpoint)
// Returns aggregated stats per calendar week (Monday-Sunday)
export interface AthleteSummary {
  /** Monday of the week (ISO date: YYYY-MM-DD) */
  date: string;
  /** Number of activities in this week */
  count: number;
  /** Total time in seconds */
  time: number;
  /** Total moving time in seconds */
  moving_time: number;
  /** Total elapsed time in seconds */
  elapsed_time: number;
  /** Total calories burned */
  calories: number;
  /** Total elevation gain in meters */
  total_elevation_gain: number;
  /** Total training load */
  training_load: number;
  /** Session RPE load */
  srpe: number;
  /** Total distance in meters */
  distance: number;
  /** Estimated FTP for this period */
  eftp: number | null;
  /** Estimated FTP per kg */
  eftpPerKg: number | null;
  /** Athlete ID */
  athlete_id: string;
  /** Athlete name */
  athlete_name: string;
  /** Fitness (CTL) at end of this week */
  fitness: number;
  /** Fatigue (ATL) at end of this week */
  fatigue: number;
  /** Form (TSB) at end of this week */
  form: number;
  /** Ramp rate */
  rampRate: number;
  /** Athlete weight */
  weight: number | null;
  /** Time in HR zones (seconds per zone) */
  timeInZones: number[];
  /** Total time across all zones */
  timeInZonesTot: number;
  /** Per-sport category breakdown */
  byCategory: AthleteSummaryCategory[];
  /** Most recent wellness entry ID */
  mostRecentWellnessId: string;
}

// Per-sport breakdown within athlete summary
export interface AthleteSummaryCategory {
  /** Sport category (e.g., 'Run', 'Ride') */
  category: string;
  /** Number of activities */
  count: number;
  /** Total time in seconds */
  time: number;
  /** Total moving time in seconds */
  moving_time: number;
  /** Total elapsed time in seconds */
  elapsed_time: number;
  /** Total calories burned */
  calories: number;
  /** Total elevation gain in meters */
  total_elevation_gain: number;
  /** Total training load */
  training_load: number;
  /** Session RPE load */
  srpe: number;
  /** Total distance in meters */
  distance: number;
  /** Estimated FTP for this period */
  eftp: number | null;
  /** Estimated FTP per kg */
  eftpPerKg: number | null;
}
