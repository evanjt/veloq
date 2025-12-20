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
  icu_athlete_id?: string;
  // Stream types available for this activity
  stream_types?: string[];
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
}
