export type InsightCategory =
  | 'section_pr'
  | 'section_trend'
  | 'stale_pr'
  | 'fitness_milestone'
  | 'period_comparison'
  | 'strength_progression'
  | 'strength_balance'
  | 'hrv_trend'
  | 'efficiency_trend';

export type InsightPriority = 1 | 2 | 3 | 4 | 5;

export interface DataPoint {
  label: string;
  value: number | string;
  unit?: string;
  context?: 'good' | 'warning' | 'concern' | 'neutral';
  range?: { min: number; max: number; label?: string };
}

export interface InsightAlternative {
  key: string;
  label: string;
  isSelected: boolean;
  reasoning: string;
  thresholds?: DataPoint[];
}

export interface InsightMethodology {
  name: string;
  description: string;
  formula?: string;
  reference?: string;
  referenceUrl?: string;
}

export interface SupportingSection {
  sectionId: string;
  sectionName: string;
  bestTime?: number;
  trend?: number;
  traversalCount?: number;
  sportType?: string;
  hasRecentPR?: boolean;
  daysSinceLast?: number;
}

export interface SupportingActivity {
  activityId: string;
  activityName: string;
  date: string;
  duration?: number;
  sportType?: string;
}

export interface InsightSupportingData {
  dataPoints?: DataPoint[];
  sections?: SupportingSection[];
  activities?: SupportingActivity[];
  sparklineData?: number[];
  sparklineLabel?: string;
  comparisonData?: {
    current: DataPoint;
    previous: DataPoint;
    change: DataPoint;
  };
  formula?: string;
  algorithmDescription?: string;
}

export interface InsightMeta {
  /**
   * Epoch ms when the triggering event occurred (PR date, trend-window end,
   * milestone date). Drives the recency gate (G1). Falls back to
   * `Insight.timestamp` (generation time) when unset — treat unset as "fresh".
   */
  sourceTimestamp?: number;
  /**
   * Centroid of the section/route the insight references, if location-bound.
   * Drives the proximity gate (G2). Absent for non-location insights
   * (fitness milestones, HRV, strength).
   */
  location?: { lat: number; lng: number };
  /**
   * 'self' compares the user to their own past (Kappen 2018 — preferred).
   * 'other' compares to population/others. 'none' for pure status facts.
   */
  comparisonKind?: 'self' | 'other' | 'none';
  /** Lifetime count of the repeated behaviour — drives repetition gate (G3). */
  repetitionCount?: number;
  /** Proximal-specificity tags — drives R5 ranking bonus. */
  specificity?: { hasNumber: boolean; hasPlace: boolean; hasDate: boolean };
  /** Optional signal-to-noise delta (|value − baseline| / stddev) — drives R6. */
  signalDelta?: number;
}

export interface Insight {
  id: string;
  category: InsightCategory;
  priority: InsightPriority;
  title: string;
  subtitle?: string;
  icon: string;
  iconColor: string;
  body?: string;
  navigationTarget?: string;
  timestamp: number;
  isNew: boolean;
  alternatives?: InsightAlternative[];
  supportingData?: InsightSupportingData;
  methodology?: InsightMethodology;
  confidence?: number;
  meta?: InsightMeta;
}
