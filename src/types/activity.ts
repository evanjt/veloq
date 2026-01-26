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
  icu_zone_times?: Array<{ id: string; secs: number }>;
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
}

export interface Athlete {
  id: string;
  name: string;
  email?: string;
  profile?: string; // URL to profile photo
  profile_medium?: string; // URL to medium profile photo
}

// Wellness/Fitness data for CTL/ATL/TSB chart
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

// Daily activity summary for the fitness chart
export interface DailyActivitySummary {
  date: string;
  load?: number; // Training load for the day
  activities: {
    id: string;
    type: ActivityType;
    name: string;
    duration: number;
    distance?: number;
    load?: number;
    averageHr?: number;
    averageWatts?: number;
  }[];
}

// Power/Pace curve data point - best effort at a specific duration
export interface CurvePoint {
  secs: number; // Duration in seconds
  value: number; // Power (watts) or pace (m/s)
  activity_id?: string; // Activity where this best was achieved
  start_index?: number; // Start index in activity stream
}

// Power curve response from API
export interface PowerCurve {
  type: 'power';
  sport: string;
  secs: number[]; // Array of durations
  watts: number[]; // Best watts for each duration
  watts_per_kg?: number[]; // Best w/kg for each duration
  activity_ids?: string[]; // Activity IDs for each best
}

// Pace curve response (for running)
export interface PaceCurve {
  type: 'pace';
  sport: string;
  distances: number[]; // Array of distances in meters
  times: number[]; // Array of times in seconds to cover each distance
  pace: number[]; // Pace in m/s at each distance (distance/time)
  activity_ids?: string[];
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

// Cache structure for activity bounds
export interface ActivityBoundsCache {
  lastSync: string; // ISO date of most recent sync
  oldestSynced: string; // ISO date of oldest synced activity
  activities: Record<string, ActivityBoundsItem>;
}

// Map data response from API
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
