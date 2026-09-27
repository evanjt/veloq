/**
 * Activity types supported by intervals.icu (based on Strava API types).
 * Keep in sync with:
 * - src/lib/validation/schemas.ts (ActivityTypeSchema)
 * - src/types/routes.ts (VALID_ACTIVITY_TYPES)
 * - src/lib/utils/activityUtils.ts (ACTIVITY_ICONS)
 */
export type ActivityType =
  // Cycling
  | 'Ride'
  | 'VirtualRide'
  | 'EBikeRide'
  | 'MountainBikeRide'
  | 'GravelRide'
  | 'TrackRide'
  | 'Cyclocross'
  | 'Velomobile'
  | 'Handcycle'
  // Running
  | 'Run'
  | 'VirtualRun'
  | 'TrailRun'
  | 'Treadmill'
  // Walking/Hiking
  | 'Walk'
  | 'Hike'
  // Swimming
  | 'Swim'
  | 'OpenWaterSwim'
  // Snow sports
  | 'AlpineSki'
  | 'NordicSki'
  | 'BackcountrySki'
  | 'Snowboard'
  | 'Snowshoe'
  | 'RollerSki'
  // Water sports
  | 'Rowing'
  | 'VirtualRow'
  | 'Kayaking'
  | 'Canoeing'
  | 'Surfing'
  | 'Kitesurf'
  | 'Windsurf'
  | 'StandUpPaddling'
  | 'Sail'
  // Skating
  | 'IceSkate'
  | 'InlineSkate'
  | 'Skateboard'
  // Gym/Fitness
  | 'Workout'
  | 'WeightTraining'
  | 'Yoga'
  | 'Pilates'
  | 'Crossfit'
  | 'Elliptical'
  | 'StairStepper'
  | 'HighIntensityIntervalTraining'
  // Racket sports
  | 'Tennis'
  | 'Badminton'
  | 'Pickleball'
  | 'Racquetball'
  | 'Squash'
  | 'TableTennis'
  // Other sports
  | 'Soccer'
  | 'Golf'
  | 'RockClimbing'
  | 'Wheelchair'
  // Catch-all
  | 'Other';

export interface Activity {
  id: string;
  name: string;
  type: ActivityType;
  start_date_local: string;
  moving_time: number;
  elapsed_time: number;
  distance: number;
  total_elevation_gain: number;
  // Heart rate - API returns both formats depending on endpoint
  icu_average_hr?: number | undefined;
  icu_max_hr?: number | undefined;
  average_heartrate?: number | undefined;
  max_heartrate?: number | undefined;
  // Power
  average_watts?: number | undefined;
  max_watts?: number | undefined;
  icu_average_watts?: number | undefined;
  weighted_average_watts?: number | undefined; // Normalized power (NP)
  average_speed: number;
  max_speed: number;
  average_cadence?: number | undefined;
  calories?: number | undefined;
  pacing_index?: number | undefined; // Aerobic decoupling metric
  start_latlng?: [number, number] | undefined;
  end_latlng?: [number, number] | undefined;
  // Location info
  locality?: string | undefined; // City/town name from intervals.icu
  country?: string | undefined; // Country name
  icu_athlete_id?: string | undefined;
  // Stream types available for this activity
  stream_types?: string[] | undefined;
  // Zone time distributions
  // icu_zone_times is array of {id: 'Z1', secs: 123} objects (power zones)
  icu_zone_times?: { id: string; secs: number }[] | undefined;
  // icu_hr_zone_times is flat array of seconds per HR zone
  icu_hr_zone_times?: number[] | undefined;
  // Zone thresholds
  icu_power_zones?: number[] | undefined;
  icu_hr_zones?: number[] | undefined;
  // Training metrics
  icu_training_load?: number | undefined; // TSS
  icu_ftp?: number | undefined; // FTP used for this activity
  icu_pm_ftp_watts?: number | undefined; // Estimated FTP from this activity (eFTP)
  icu_rolling_ftp?: number | undefined; // eFTP intervals.icu accepted after this activity
  icu_rolling_ftp_delta?: number | undefined; // Change this activity made to it, zero or absent when none
  icu_intensity?: number | undefined; // Intensity Factor as percentage (e.g., 92.26 = 92%)
  icu_efficiency_factor?: number | undefined; // Power:HR efficiency
  trimp?: number | undefined; // Training impulse (HR-based load)
  decoupling?: number | undefined; // Aerobic decoupling/drift percentage
  strain_score?: number | undefined; // Strain score
  icu_hrr?: {
    // Heart rate recovery
    start_bpm: number;
    end_bpm: number;
    hrr: number; // BPM drop
  };
  // Weather data (when available from intervals.icu)
  has_weather?: boolean | undefined;
  average_weather_temp?: number | undefined; // Temperature in Celsius
  average_feels_like?: number | undefined; // Feels like temperature (alias for apparent_temperature)
  apparent_temperature?: number | undefined; // Feels like temperature (primary field)
  average_temp_feels_like?: number | undefined; // Deprecated: use apparent_temperature or average_feels_like
  average_wind_speed?: number | undefined; // Wind speed in m/s
  average_weather_wind_speed?: number | undefined; // Deprecated: use average_wind_speed
  average_wind_gust?: number | undefined; // Wind gust in m/s
  average_clouds?: number | undefined; // Cloud cover percentage
  average_weather_humidity?: number | undefined; // Humidity percentage
  // Device temperature (from watch sensor, not weather)
  average_temp?: number | undefined;
  // Skyline chart - compact protobuf encoding of interval zones/durations
  skyline_chart_bytes?: string | undefined;
}

export interface ActivityDetail extends Activity {
  description?: string;
  device_name?: string;
  icu_power_hr_z2?: number;
  icu_power_hr_z3?: number;
  icu_power_hr_z4?: number;
  icu_power_hr_z5?: number;
  // HR zones - BPM thresholds (from intervals.icu)
  icu_hr_zones?: number[];
}

// Raw stream object from API
export interface RawStreamItem {
  type: string;
  name: string | null;
  data: number[];
  data2?: number[]; // Only for latlng - contains longitude values
}

// Processed streams in a usable format
export interface ActivityStreams {
  time?: number[];
  latlng?: [number, number][];
  altitude?: number[];
  heartrate?: number[];
  watts?: number[];
  cadence?: number[];
  velocity_smooth?: number[];
  distance?: number[];
  grade_smooth?: number[];
  temp?: number[];
  /** W' balance stream in joules remaining. Sourced from intervals.icu's
   * `w_bal` stream. Only populated when the server has computed it (power +
   * FTP + W'). */
  wbal?: number[];
  /** Grade-Adjusted Pace in min/km. Converted from intervals.icu's
   * `ga_velocity` stream (m/s) at parse time. */
  gap?: number[];
}

/**
 * One interval of an activity, as intervals.icu sends it.
 *
 * Measured from the live body rather than hand-listed: 84 keys, of which the
 * six below are on every interval of every activity measured and the rest are
 * mostly null on any one of them. Optional and nullable are both true of the
 * body, so both are said. The fixture in
 * `src/__tests__/__fixtures__/intervalBodies.json` is three real bodies with
 * their values moved off the athlete's own readings, and it is what keeps this
 * shape true: the next census is a diff.
 */
export interface ActivityInterval {
  average_cadence?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_dfa_a1?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_epoc?: number | null | undefined;
  average_feels_like?: number | null | undefined;
  average_gradient?: number | null | undefined;
  average_heartrate?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_impact_loading_rate?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_lactate?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_leg_spring_stiffness?: number | null | undefined;
  average_respiration?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_smo2?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_smo2_2?: number | null | undefined;
  average_speed?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time_balance?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time_percent?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_step_length?: number | null | undefined;
  average_stride?: number | null | undefined;
  average_temp?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_thb?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_thb_2?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_tidal_volume?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_tidal_volume_min?: number | null | undefined;
  average_torque?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_oscillation?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_ratio?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_speed?: number | null | undefined;
  average_watts?: number | null | undefined;
  average_watts_alt?: number | null | undefined;
  average_watts_alt_acc?: number | null | undefined;
  average_watts_kg?: number | null | undefined;
  average_weather_temp?: number | null | undefined;
  average_wind_gust?: number | null | undefined;
  average_wind_speed?: number | null | undefined;
  average_yaw?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  avg_lr_balance?: number | null | undefined;
  /** A number, or the string `-Infinity` when the second half carried no power. */
  decoupling?: number | string | null | undefined;
  distance?: number | null | undefined;
  elapsed_time?: number | null | undefined;
  end_index: number;
  /** Elapsed seconds from the activity start. */
  end_time: number;
  gap?: number | null | undefined;
  /** The group's own id, a duration and an average rather than a number or an index. */
  group_id?: string | null | undefined;
  headwind_percent?: number | null | undefined;
  id: number;
  intensity?: number | null | undefined;
  joules?: number | null | undefined;
  joules_above_ftp?: number | null | undefined;
  /** The athlete's own words for this interval, where a workout was planned. */
  label?: string | null | undefined;
  max_altitude?: number | null | undefined;
  max_cadence?: number | null | undefined;
  max_heartrate?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  max_lactate?: number | null | undefined;
  max_speed?: number | null | undefined;
  max_torque?: number | null | undefined;
  max_watts?: number | null | undefined;
  max_watts_kg?: number | null | undefined;
  min_altitude?: number | null | undefined;
  min_cadence?: number | null | undefined;
  min_heartrate?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  min_lactate?: number | null | undefined;
  min_speed?: number | null | undefined;
  min_torque?: number | null | undefined;
  min_watts?: number | null | undefined;
  moving_time?: number | null | undefined;
  prevailing_wind_deg?: number | null | undefined;
  /** Null on every activity measured. A list where it is not. */
  segment_effort_ids?: number[] | null | undefined;
  ss_cp?: number | null | undefined;
  ss_p_max?: number | null | undefined;
  /** The server fits its own W prime, so this arrives whether or not the
   * athlete configured one. */
  ss_w_prime?: number | null | undefined;
  start_index: number;
  /** Elapsed seconds from the activity start. Index-free, so it survives the
   * `latlng` reduction both stream readers apply, which `start_index` does not. */
  start_time: number;
  strain_score?: number | null | undefined;
  tailwind_percent?: number | null | undefined;
  total_elevation_gain?: number | null | undefined;
  training_load?: number | null | undefined;
  /** Only `WORK` and `RECOVERY` were witnessed on the measured account. The
   * other four stay because unwitnessed is not the same as absent. */
  type: 'WORK' | 'RECOVERY' | 'REST' | 'WARMUP' | 'COOLDOWN' | 'ACTIVE_RECOVERY';
  w5s_variability?: number | null | undefined;
  wbal_end?: number | null | undefined;
  /** The server fits its own W prime, so this arrives whether or not the
   * athlete configured one. */
  wbal_start?: number | null | undefined;
  weighted_average_watts?: number | null | undefined;
  zone?: number | null | undefined;
  zone_max_watts?: number | null | undefined;
  zone_min_watts?: number | null | undefined;
}

// Response from /api/v1/activity/{id}/intervals
export interface IntervalsDTO {
  icu_intervals: ActivityInterval[];
  icu_groups: ActivityIntervalGroup[];
}

/**
 * A group of intervals sharing a shape.
 *
 * The same field set as its members minus `intensity`, plus a `count`. Its
 * `id` is what a member's `group_id` holds. Nothing renders a group today.
 */
export interface ActivityIntervalGroup {
  average_cadence?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_dfa_a1?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_epoc?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_feels_like?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_gradient?: number | null | undefined;
  average_heartrate?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_impact_loading_rate?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_lactate?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_leg_spring_stiffness?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_respiration?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_smo2?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_smo2_2?: number | null | undefined;
  average_speed?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time_balance?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time_percent?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_step_length?: number | null | undefined;
  average_stride?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_temp?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_thb?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_thb_2?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_tidal_volume?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_tidal_volume_min?: number | null | undefined;
  average_torque?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_oscillation?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_ratio?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_speed?: number | null | undefined;
  average_watts?: number | null | undefined;
  average_watts_alt?: number | null | undefined;
  average_watts_alt_acc?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_watts_kg?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_weather_temp?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_wind_gust?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_wind_speed?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  average_yaw?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  avg_lr_balance?: number | null | undefined;
  count: number;
  /** A number, or the string `-Infinity` when the second half carried no power. */
  decoupling?: number | string | null | undefined;
  distance?: number | null | undefined;
  elapsed_time?: number | null | undefined;
  gap?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  headwind_percent?: number | null | undefined;
  id: string;
  /** Sport-specific, and null on every interval of the measured account. */
  intensity?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  joules?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  joules_above_ftp?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  max_altitude?: number | null | undefined;
  max_cadence?: number | null | undefined;
  max_heartrate?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  max_lactate?: number | null | undefined;
  max_speed?: number | null | undefined;
  max_torque?: number | null | undefined;
  max_watts?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  max_watts_kg?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  min_altitude?: number | null | undefined;
  min_cadence?: number | null | undefined;
  min_heartrate?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  min_lactate?: number | null | undefined;
  min_speed?: number | null | undefined;
  min_torque?: number | null | undefined;
  min_watts?: number | null | undefined;
  moving_time?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  prevailing_wind_deg?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  ss_cp?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  ss_p_max?: number | null | undefined;
  /** The server fits its own W prime, so this arrives whether or not the
   * athlete configured one. */
  ss_w_prime?: number | null | undefined;
  start_index?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  strain_score?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  tailwind_percent?: number | null | undefined;
  total_elevation_gain?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  training_load?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  w5s_variability?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  wbal_end?: number | null | undefined;
  /** The server fits its own W prime, so this arrives whether or not the
   * athlete configured one. */
  wbal_start?: number | null | undefined;
  /** Sport-specific, and null on every interval of the measured account. */
  weighted_average_watts?: number | null | undefined;
  zone?: number | null | undefined;
  zone_max_watts?: number | null | undefined;
  zone_min_watts?: number | null | undefined;
}

export interface Athlete {
  id: string;
  name: string;
  email?: string;
  sex?: string; // "M" or "F" from intervals.icu
  profile?: string; // URL to profile photo
  profile_medium?: string; // URL to medium profile photo
  /**
   * Anaerobic work capacity in joules. Used for W'bal chart computation.
   * Defaults to 20 kJ when not provided by intervals.icu (common mid-range
   * value for trained amateurs; elites can exceed 30 kJ).
   */
  wPrime?: number;
}

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

// Sport settings including zones
export interface SportSettings {
  id?: string;
  types: string[]; // Activity types this applies to
  // Power zones
  ftp?: number; // Functional Threshold Power
  power_zones?: Zone[];
  // HR zones
  lthr?: number; // Lactate Threshold Heart Rate
  max_hr?: number;
  hr_zones?: Zone[];
  // Pace zones (running)
  threshold_pace?: number; // m/s
  pace_zones?: Zone[];
  // Other settings
  weight?: number;
}

// Zone definition
export interface Zone {
  id: number;
  name: string;
  min?: number;
  max?: number;
  color?: string;
}

// Zone distribution for a time period
export interface ZoneDistribution {
  zone: number;
  name: string;
  seconds: number; // Time in this zone
  percentage: number; // % of total time
  color: string;
}

// eFTP history point
export interface eFTPPoint {
  date: string;
  eftp: number;
  activity_id?: string;
  activity_name?: string;
}

// Activity bounds for regional map (includes GPS for route matching)
export interface ActivityBoundsItem {
  id: string;
  bounds: [[number, number], [number, number]]; // [[minLat, minLng], [maxLat, maxLng]]
  type: ActivityType;
  name: string;
  date: string; // ISO date
  distance: number; // meters
  duration: number; // seconds
  /** Full GPS track - stored during sync for instant route matching */
  latlngs?: [number, number][] | undefined;
  /**
   * Where the ride began, from the engine's own signature record. The map
   * marker belongs here rather than at the centre of the bounding box, and
   * having it on the first read is what stops every marker being uploaded once
   * on its bounds centre and again once the signatures finish loading.
   * Absent for an activity the engine holds no signature for.
   */
  startPoint?: [number, number] | undefined;
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
  /** Total training load (TSS) */
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
  /** Total training load (TSS) */
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
