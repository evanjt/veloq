export type InsightCategory =
  | 'section_pr'
  | 'fitness_milestone'
  | 'period_comparison'
  | 'activity_pattern'
  | 'training_consistency';

export type InsightPriority = 1 | 2 | 3 | 4 | 5;

export interface Insight {
  id: string;
  category: InsightCategory;
  priority: InsightPriority;
  title: string;
  subtitle?: string;
  icon: string; // MaterialCommunityIcons name
  iconColor: string;
  body?: string; // detailed explanation shown in modal
  navigationTarget?: string; // route to navigate to
  timestamp: number; // when the insight was generated
  isNew: boolean;
}
