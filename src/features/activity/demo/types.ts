// Demo fixture shapes that mirror the Intervals.icu API response format exactly.
// Matching the real API shape keeps the app's demo path identical to live data.

export interface ApiActivity {
  id: string;
  start_date_local: string;
  type: string;
  name: string;
  description: string | null;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  total_elevation_loss: number;
  average_speed: number;
  max_speed: number;
  average_heartrate: number | null;
  max_heartrate: number | null;
  average_cadence: number | null;
  average_temp: number | null;
  calories: number;
  device_name: string;
  trainer: boolean;
  commute: boolean;
  icu_training_load: number | null;
  icu_intensity: number | null;
  icu_ftp: number | null;
  icu_atl: number;
  icu_ctl: number;
  average_watts: number | null;
  weighted_average_watts: number | null;
  icu_hr_zones: number[];
  icu_power_zones: number[];
  icu_zone_times: Array<{ id: string; secs: number }> | null;
  stream_types: string[];
  locality: string | null;
  country: string | null;
  skyline_chart_bytes?: string;
}

export interface ApiWellness {
  id: string; // date string YYYY-MM-DD
  ctl: number;
  atl: number;
  rampRate: number;
  ctlLoad: number;
  atlLoad: number;
  sportInfo: Array<{
    type: string;
    eftp: number;
    wPrime: number;
    pMax: number;
  }>;
  weight: number | null;
  restingHR: number | null;
  hrv: number | null;
  hrvSDNN: number | null;
  sleepSecs: number | null;
  sleepScore: number | null;
  sleepQuality: number | null;
  steps: number | null;
  vo2max: number | null;
}

export interface ApiActivityMap {
  bounds: [[number, number], [number, number]];
  latlngs: [number, number][] | null;
  route: null;
  weather: null;
}

export interface ApiActivityStreams {
  time: number[];
  latlng?: [number, number][];
  heartrate?: number[];
  watts?: number[];
  altitude?: number[];
  fixed_altitude?: number[];
  cadence?: number[];
  distance?: number[];
  velocity_smooth?: number[];
  grade_smooth?: number[];
  temp?: number[];
}

export interface ApiAthlete {
  id: string;
  name: string;
  profile_medium: string | null;
  locale: string;
  timezone: string;
  icu_weight: number;
  icu_ftp: number;
  icu_lthr: number;
  icu_max_hr: number;
  icu_resting_hr: number;
}
