export {
  SummaryCard,
  SummaryCardSkeleton,
  type SummaryCardProps,
  SummaryCardSparkline,
  SummaryCardHRVSparkline,
  SupportCard,
  FeedFirstSyncStandby,
  FeedEmptyLibrary,
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

export { feedEmptyState, type FeedEmptyState } from './lib/feedEmptyState';
export { summaryCardTarget } from './lib/summaryCardTargets';
export {
  refreshSampleWidgets,
  resetWidgetSnapshot,
  updateWidgetSnapshot,
  writeWidgetSnapshot,
} from './lib/widgetBridge';
export {
  composeWidgetContext,
  gatherWidgetSnapshot,
  type WidgetSnapshotPayload,
} from './lib/widgetSnapshot';
export { readPlannedWorkouts } from './lib/calendarEvents';
