export type ActivityType =
  | 'Ride'
  | 'Run'
  | 'Swim'
  | 'Walk'
  | 'Hike'
  | 'VirtualRide'
  | 'VirtualRun'
  | 'Workout'
  | 'WeightTraining'
  | 'Yoga'
  | 'Snowboard'
  | 'AlpineSki'
  | 'NordicSki'
  | 'BackcountrySki'
  | 'Rowing'
  | 'Kayaking'
  | 'Canoeing'
  | 'OpenWaterSwim'
  | 'TrailRun'
  | 'Snowshoe'
  | 'Tennis'
  | 'RockClimbing'
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
  average_speed: number;
  max_speed: number;
  average_cadence?: number;
  calories?: number;
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
  // Weather data (when available from intervals.icu)
  has_weather?: boolean;
  average_weather_temp?: number; // Temperature in Celsius
  average_feels_like?: number; // Feels like temperature
  average_wind_speed?: number; // Wind speed in m/s
  average_wind_gust?: number; // Wind gust in m/s
  average_clouds?: number; // Cloud cover percentage
}

export interface ActivityDetail extends Activity {
  description?: string;
  device_name?: string;
  icu_power_hr_z2?: number;
  icu_power_hr_z3?: number;
  icu_power_hr_z4?: number;
  icu_power_hr_z5?: number;
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
  hrv?: number;
  hrvSDNN?: number;
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
  secs: number;           // Duration in seconds
  value: number;          // Power (watts) or pace (m/s)
  activity_id?: string;   // Activity where this best was achieved
  start_index?: number;   // Start index in activity stream
}

// Power curve response from API
export interface PowerCurve {
  type: 'power';
  sport: string;
  secs: number[];         // Array of durations
  watts: number[];        // Best watts for each duration
  watts_per_kg?: number[]; // Best w/kg for each duration
  activity_ids?: string[]; // Activity IDs for each best
}

// Pace curve response (for running)
export interface PaceCurve {
  type: 'pace';
  sport: string;
  secs: number[];         // Array of durations
  gap?: number[];         // Grade adjusted pace
  pace?: number[];        // Pace in m/s
  activity_ids?: string[];
}

// Sport settings including zones
export interface SportSettings {
  id?: string;
  types: string[];        // Activity types this applies to
  // Power zones
  ftp?: number;           // Functional Threshold Power
  power_zones?: Zone[];
  // HR zones
  lthr?: number;          // Lactate Threshold Heart Rate
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
  seconds: number;        // Time in this zone
  percentage: number;     // % of total time
  color: string;
}

// eFTP history point
export interface eFTPPoint {
  date: string;
  eftp: number;
  activity_id?: string;
  activity_name?: string;
}

// Activity bounds for regional map (lightweight cache)
export interface ActivityBoundsItem {
  id: string;
  bounds: [[number, number], [number, number]]; // [[minLat, minLng], [maxLat, maxLng]]
  type: ActivityType;
  name: string;
  date: string; // ISO date
  distance: number; // meters
  duration: number; // seconds
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
