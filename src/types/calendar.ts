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

export interface ActivityPattern {
  sportType: string;
  clusterId: number;
  primaryDay: number; // 0=Mon..6=Sun
  seasonLabel: string; // 'winter', 'spring', 'summer', 'autumn'
  activityCount: number;
  avgDurationSecs: number;
  avgTss: number;
  avgDistanceMeters: number;
  frequencyPerMonth: number;
  confidence: number; // 0.0-1.0, UI threshold: >=0.6
  silhouetteScore: number;
  daysSinceLast: number;
  commonSections: PatternSection[];
}

export interface PatternSection {
  sectionId: string;
  sectionName: string;
  appearanceRate: number; // 0.0-1.0
  bestTimeSecs: number;
  medianRecentSecs: number; // median of last 5 traversals
  trend: number | null; // null=insufficient data, -1=declining, 0=stable, 1=improving
  traversalCount: number;
}
