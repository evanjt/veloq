export interface CalendarEvent {
  id: number;
  name: string;
  start_date_local: string;
  category: 'WORKOUT' | 'NOTE' | 'TARGET' | 'SEASON' | 'RACE';
  type: string; // sport: 'Ride', 'Run', 'Swim', etc.
  description: string; // intervals.icu workout DSL text
  moving_time: number; // planned duration in seconds
  icu_training_load: number; // planned TSS
  target: 'POWER' | 'HR' | 'PACE' | null;
  workout_doc: WorkoutDoc | null;
}

export interface WorkoutDoc {
  steps: WorkoutStep[];
  duration: number;
  target: string; // 'W' = power, 'H' = HR, 'P' = pace
  ftp?: number;
  lthr?: number;
  threshold_pace?: number;
  zoneTimes?: { secs: number; id: string }[];
}

export interface WorkoutStep {
  text?: string;
  duration?: number;
  distance?: number;
  reps?: number;
  intensity?: string;
  warmup?: boolean;
  cooldown?: boolean;
  ramp?: boolean;
  power?: { value?: number; start?: number; end?: number; units?: string };
  hr?: { value?: number; start?: number; end?: number; units?: string };
  pace?: { value?: number; start?: number; end?: number; units?: string };
  _power?: { value?: number; start?: number; end?: number }; // resolved watts
  _hr?: { value?: number; start?: number; end?: number };
  steps?: WorkoutStep[]; // nested for repeat blocks
}

/**
 * Activity patterns come straight from the engine's k-means clustering, so the
 * generated record is the app type.
 */
export type { FfiActivityPattern as ActivityPattern } from 'veloqrs';
