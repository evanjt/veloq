export type InsightCategory =
  | 'section_pr'
  | 'fitness_milestone'
  | 'period_comparison'
  | 'activity_pattern'
  | 'training_consistency'
  | 'recovery_readiness'
  | 'workload_risk'
  | 'section_performance'
  | 'form_trajectory';

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
}

export interface SupportingSection {
  sectionId: string;
  sectionName: string;
  bestTime?: number;
  trend?: number;
  traversalCount?: number;
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
}
