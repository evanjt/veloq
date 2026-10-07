export {
  SummaryCard,
  type SummaryCardProps,
  SummaryCardSparkline,
  SummaryCardHRVSparkline,
  NotificationOptInCard,
  SupportCard,
  FeedFirstSyncStandby,
} from './components';

export {
  useSummaryCardData,
  type SummaryCardData,
  useTodayWorkout,
  useWorkoutSections,
  type WorkoutSection,
  useStartupData,
  type StartupResult,
  type PreviewTrack,
} from './hooks';

export {
  useDashboardPreferences,
  initializeDashboardPreferences,
  getMetricDefinition,
  AVAILABLE_METRICS,
  HERO_METRICS,
  isHeroMetricId,
  type HeroMetricId,
  type MetricId,
  type MetricDefinition,
} from './store';

export { feedEmptyState, type FeedEmptyState } from './lib/feedEmptyState';
export { summaryCardTarget } from './lib/summaryCardTargets';
export { clearWidgetSnapshot, updateWidgetSnapshot, writeWidgetSnapshot } from './lib/widgetBridge';
export {
  composeWidgetContext,
  gatherWidgetSnapshot,
  type WidgetContext,
  type WidgetSnapshotPayload,
} from './lib/widgetSnapshot';
export { readCalendarEvents } from './lib/calendarEvents';
