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
  icu_average_hr?: number;
  icu_max_hr?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  // Power
  average_watts?: number;
  max_watts?: number;
  icu_average_watts?: number;
  weighted_average_watts?: number; // Normalized power (NP)
  average_speed: number;
  max_speed: number;
  average_cadence?: number;
  calories?: number;
  pacing_index?: number; // Aerobic decoupling metric
  start_latlng?: [number, number];
  end_latlng?: [number, number];
  polyline?: string;
  // Location info
  locality?: string; // City/town name from intervals.icu
  country?: string; // Country name
  icu_athlete_id?: string;
  // Stream types available for this activity
  stream_types?: string[];
  // Zone time distributions
  // icu_zone_times is array of {id: 'Z1', secs: 123} objects (power zones)
  icu_zone_times?: { id: string; secs: number }[];
  // icu_hr_zone_times is flat array of seconds per HR zone
  icu_hr_zone_times?: number[];
  // Zone thresholds
  icu_power_zones?: number[];
  icu_hr_zones?: number[];
  // Training metrics
  icu_training_load?: number; // TSS
  icu_ftp?: number; // FTP used for this activity
  icu_pm_ftp_watts?: number; // Estimated FTP from this activity (eFTP)
  icu_intensity?: number; // Intensity Factor as percentage (e.g., 92.26 = 92%)
  icu_efficiency_factor?: number; // Power:HR efficiency
  trimp?: number; // Training impulse (HR-based load)
  decoupling?: number; // Aerobic decoupling/drift percentage
  strain_score?: number; // Strain score
  icu_hrr?: {
    // Heart rate recovery
    start_bpm: number;
    end_bpm: number;
    hrr: number; // BPM drop
  };
  // Weather data (when available from intervals.icu)
  has_weather?: boolean;
  average_weather_temp?: number; // Temperature in Celsius
  average_feels_like?: number; // Feels like temperature (alias for apparent_temperature)
  apparent_temperature?: number; // Feels like temperature (primary field)
  average_temp_feels_like?: number; // Deprecated: use apparent_temperature or average_feels_like
  average_wind_speed?: number; // Wind speed in m/s
  average_weather_wind_speed?: number; // Deprecated: use average_wind_speed
  average_wind_gust?: number; // Wind gust in m/s
  average_clouds?: number; // Cloud cover percentage
  average_weather_humidity?: number; // Humidity percentage
  // Device temperature (from watch sensor, not weather)
  average_temp?: number;
  // Skyline chart - compact protobuf encoding of interval zones/durations
  skyline_chart_bytes?: string;
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
  average_cadence?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_dfa_a1?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_epoc?: number | null;
  average_feels_like?: number | null;
  average_gradient?: number | null;
  average_heartrate?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_impact_loading_rate?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_lactate?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_leg_spring_stiffness?: number | null;
  average_respiration?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_smo2?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_smo2_2?: number | null;
  average_speed?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time_balance?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time_percent?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_step_length?: number | null;
  average_stride?: number | null;
  average_temp?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_thb?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_thb_2?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_tidal_volume?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_tidal_volume_min?: number | null;
  average_torque?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_oscillation?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_ratio?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_speed?: number | null;
  average_watts?: number | null;
  average_watts_alt?: number | null;
  average_watts_alt_acc?: number | null;
  average_watts_kg?: number | null;
  average_weather_temp?: number | null;
  average_wind_gust?: number | null;
  average_wind_speed?: number | null;
  average_yaw?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  avg_lr_balance?: number | null;
  /** A number, or the string `-Infinity` when the second half carried no power. */
  decoupling?: number | string | null;
  distance?: number | null;
  elapsed_time?: number | null;
  end_index: number;
  /** Elapsed seconds from the activity start. */
  end_time: number;
  gap?: number | null;
  /** The group's own id, a duration and an average rather than a number or an index. */
  group_id?: string | null;
  headwind_percent?: number | null;
  id: number;
  intensity?: number | null;
  joules?: number | null;
  joules_above_ftp?: number | null;
  /** The athlete's own words for this interval, where a workout was planned. */
  label?: string | null;
  max_altitude?: number | null;
  max_cadence?: number | null;
  max_heartrate?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  max_lactate?: number | null;
  max_speed?: number | null;
  max_torque?: number | null;
  max_watts?: number | null;
  max_watts_kg?: number | null;
  min_altitude?: number | null;
  min_cadence?: number | null;
  min_heartrate?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  min_lactate?: number | null;
  min_speed?: number | null;
  min_torque?: number | null;
  min_watts?: number | null;
  moving_time?: number | null;
  prevailing_wind_deg?: number | null;
  /** Null on every activity measured. A list where it is not. */
  segment_effort_ids?: number[] | null;
  ss_cp?: number | null;
  ss_p_max?: number | null;
  /** The server fits its own W prime, so this arrives whether or not the
   * athlete configured one. */
  ss_w_prime?: number | null;
  start_index: number;
  /** Elapsed seconds from the activity start. Index-free, so it survives the
   * `latlng` reduction both stream readers apply, which `start_index` does not. */
  start_time: number;
  strain_score?: number | null;
  tailwind_percent?: number | null;
  total_elevation_gain?: number | null;
  training_load?: number | null;
  /** Only `WORK` and `RECOVERY` were witnessed on the measured account. The
   * other four stay because unwitnessed is not the same as absent. */
  type: 'WORK' | 'RECOVERY' | 'REST' | 'WARMUP' | 'COOLDOWN' | 'ACTIVE_RECOVERY';
  w5s_variability?: number | null;
  wbal_end?: number | null;
  /** The server fits its own W prime, so this arrives whether or not the
   * athlete configured one. */
  wbal_start?: number | null;
  weighted_average_watts?: number | null;
  zone?: number | null;
  zone_max_watts?: number | null;
  zone_min_watts?: number | null;
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
  average_cadence?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_dfa_a1?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_epoc?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_feels_like?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_gradient?: number | null;
  average_heartrate?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_impact_loading_rate?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_lactate?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_leg_spring_stiffness?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_respiration?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_smo2?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_smo2_2?: number | null;
  average_speed?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time_balance?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_stance_time_percent?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_step_length?: number | null;
  average_stride?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_temp?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_thb?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_thb_2?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_tidal_volume?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_tidal_volume_min?: number | null;
  average_torque?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_oscillation?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_ratio?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_vertical_speed?: number | null;
  average_watts?: number | null;
  average_watts_alt?: number | null;
  average_watts_alt_acc?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_watts_kg?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_weather_temp?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_wind_gust?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_wind_speed?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  average_yaw?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  avg_lr_balance?: number | null;
  count: number;
  /** A number, or the string `-Infinity` when the second half carried no power. */
  decoupling?: number | string | null;
  distance?: number | null;
  elapsed_time?: number | null;
  gap?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  headwind_percent?: number | null;
  id: string;
  /** Sport-specific, and null on every interval of the measured account. */
  intensity?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  joules?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  joules_above_ftp?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  max_altitude?: number | null;
  max_cadence?: number | null;
  max_heartrate?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  max_lactate?: number | null;
  max_speed?: number | null;
  max_torque?: number | null;
  max_watts?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  max_watts_kg?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  min_altitude?: number | null;
  min_cadence?: number | null;
  min_heartrate?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  min_lactate?: number | null;
  min_speed?: number | null;
  min_torque?: number | null;
  min_watts?: number | null;
  moving_time?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  prevailing_wind_deg?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  ss_cp?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  ss_p_max?: number | null;
  /** The server fits its own W prime, so this arrives whether or not the
   * athlete configured one. */
  ss_w_prime?: number | null;
  start_index?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  strain_score?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  tailwind_percent?: number | null;
  total_elevation_gain?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  training_load?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  w5s_variability?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  wbal_end?: number | null;
  /** The server fits its own W prime, so this arrives whether or not the
   * athlete configured one. */
  wbal_start?: number | null;
  /** Sport-specific, and null on every interval of the measured account. */
  weighted_average_watts?: number | null;
  zone?: number | null;
  zone_max_watts?: number | null;
  zone_min_watts?: number | null;
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

export interface WellnessData {
  id: string; // ISO-8601 date (YYYY-MM-DD)
  ctl?: number; // Chronic Training Load (Fitness) - 42 day avg
  atl?: number; // Acute Training Load (Fatigue) - 7 day avg
  rampRate?: number; // Rate of fitness change
  ctlLoad?: number; // Alternative field name for CTL
  atlLoad?: number; // Alternative field name for ATL
  sportInfo?: SportLoadInfo[]; // Per-sport breakdown
  // Wellness metrics
  weight?: number;
  restingHR?: number;
  max_hr?: number; // Maximum heart rate
  hrv?: number;
  hrvSDNN?: number;
  hrr?: number; // Heart rate recovery
  sleepSecs?: number;
  sleepScore?: number;
  sleepQuality?: number;
  avgSleepingHR?: number;
  soreness?: number;
  fatigue?: number;
  stress?: number;
  mood?: number;
  motivation?: number;
  injury?: number;
  spO2?: number;
  systolic?: number;
  diastolic?: number;
  hydration?: number;
  hydrationVolume?: number;
  readiness?: number;
  ftp?: number; // Functional Threshold Power
  baevskySI?: number;
  bloodGlucose?: number;
  lactate?: number;
  bodyFat?: number;
  abdomen?: number;
  vo2max?: number;
  updated?: string;
}

export interface SportLoadInfo {
  eftp?: number;
  sportGroup?: string;
  types?: string[];
  ctl?: number;
  atl?: number;
  load?: number;
  dayCount?: number;
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
  watts_per_kg?: number[]; // Best w/kg for each duration
  activity_ids?: string[]; // Activity IDs for each best
  /** Activity ids for each per-kilogram best, which need not be the watts one. */
  wkg_activity_ids?: string[];
  /** The athlete's weight the per-kilogram series was divided by. */
  weight?: number;
  /** The server's fitted models, in the order it sent them. */
  models?: PowerModel[];
  /** Every activity a point came from, so a checkpoint has a date offline. */
  activities?: Record<string, CurveActivity>;
  startDate?: string;
  endDate?: string;
  days?: number;
}

// Pace curve response (for running)
export interface PaceCurve {
  type: 'pace';
  sport: string;
  distances: number[]; // Array of distances in meters
  times: number[]; // Array of times in seconds to cover each distance
  pace: number[]; // Pace in m/s at each distance (distance/time)
  activity_ids?: string[];
  /** Every activity a point came from. */
  activities?: Record<string, CurveActivity>;
  // Critical Speed model data
  criticalSpeed?: number; // Critical speed from pace model (m/s) - use as threshold pace
  dPrime?: number; // D' (anaerobic distance capacity) in meters
  r2?: number; // R² (model fit quality)
  // Date range
  startDate?: string; // Start date of the curve period (ISO string)
  endDate?: string; // End date of the curve period (ISO string)
  days?: number; // Number of days in the period
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
  latlngs?: [number, number][];
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
