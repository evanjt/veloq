export {
  useActivities,
  useInfiniteActivities,
  useActivity,
  useActivityStreams,
  useActivityIntervals,
  isInfiniteActivitiesStale,
} from './useActivities';
export { useActivityBoundsCache } from './useActivityBoundsCache';
export { useEFTPHistory, getLatestFTP, getLatestEFTP } from './useEFTPHistory';
export { useMapPreviewCoordinates } from './useMapPreviewCoordinates';
export { useSectionOverlays } from './useSectionOverlays';
export { useSectionTimeStreams } from './useSectionTimeStreams';
export { useExerciseSets, useMuscleGroups } from '@/features/strength';
export { useMuscleDetail } from '@/features/strength';
export { useActivitySectionHighlights } from './useActivitySectionHighlights';
export type {
  ActivitySectionHighlight,
  ActivityRouteHighlight,
} from './useActivitySectionHighlights';
export {
  useStrengthVolume,
  useHasStrengthData,
  useStrengthProgression,
  useExercisesForMuscle,
  useActivitiesForExercise,
} from '@/features/strength';
