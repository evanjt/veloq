/** Per-direction best record for display alongside the scatter chart */
export interface DirectionBestRecord {
  bestTime: number;
  bestSpeed?: number; // Speed (m/s) for routes where distance varies
  bestPace?: number; // Pace (s/km) for running sections
  activityDate: Date;
}

/** Per-direction summary stats for display alongside the scatter chart */
export interface DirectionSummaryStats {
  /** Average time across all traversals in this direction */
  avgTime: number | null;
  /** Average speed across all traversals (for routes where distance varies) */
  avgSpeed?: number | null;
  /** Date of most recent traversal in this direction */
  lastActivity: Date | null;
  /** Number of traversals in this direction */
  count: number;
}
