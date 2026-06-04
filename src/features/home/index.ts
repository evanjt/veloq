export {
  SummaryCard,
  type SummaryCardProps,
  MiniFormChart,
  SummaryCardSparkline,
  SummaryCardHRVSparkline,
  InsightLine,
  NotificationOptInCard,
  SupportCard,
} from './components';

export {
  useSummaryCardData,
  type SummaryCardData,
  useTodayWorkout,
  useWorkoutSections,
  type WorkoutSection,
  useActivityPatterns,
  useStartupData,
  type StartupResult,
  type PreviewTrack,
} from './hooks';

export {
  useDashboardPreferences,
  initializeDashboardPreferences,
  getMetricDefinition,
  getMetricsForSport,
  AVAILABLE_METRICS,
  type MetricId,
  type MetricDefinition,
  type MetricPreference,
} from './store';
