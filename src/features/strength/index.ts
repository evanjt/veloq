export { BodyPairWithLoupe } from './components/BodyPairWithLoupe';
export { ExerciseTable } from './components/ExerciseTable';
export { MuscleDetailSheet } from './components/MuscleDetailSheet';
export { MuscleGroupView } from './components/MuscleGroupView';
export { StrengthActivityCard, type StrengthCardData } from './components/StrengthActivityCard';
export { StrengthBodyDiagram } from './components/StrengthBodyDiagram';
export { StrengthProgressionCard } from './components/StrengthProgressionCard';
export { StrengthExerciseList } from './components/StrengthExerciseList';
export { StrengthBalanceView } from './components/StrengthBalanceView';

export { useExerciseSets, useMuscleGroups } from './hooks/useExerciseSets';
export { useMuscleDetail } from './hooks/useMuscleDetail';
export type { MuscleGroupDetail } from './hooks/useMuscleDetail';
export {
  useStrengthVolume,
  useHasStrengthData,
  useStrengthProgression,
  useExercisesForMuscle,
  useActivitiesForExercise,
} from './hooks/useStrengthVolume';
export { generateStrengthInsights } from './hooks/strengthInsights';

export { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from './lib/exerciseMuscleMap';
export { buildStrengthProgression, buildStrengthBalancePairs, BALANCE_PAIRS } from './lib/analysis';
export {
  formatWeight,
  formatWeightRounded,
  formatSetCount,
  formatBalanceRatio,
} from './lib/formatting';
export { findMuscleAtPoint, FRONT_POLYGONS, BACK_POLYGONS } from './lib/polygons';
export type { MusclePolygons, Polygon } from './lib/polygons';

export type {
  MuscleVolume,
  StrengthSummary,
  StrengthPeriod,
  StrengthProgressPoint,
  StrengthProgressTrend,
  StrengthProgression,
  StrengthBalanceStatus,
  StrengthBalancePair,
  ExerciseSummary,
  MuscleExerciseSummary,
  ExerciseActivity,
} from './types';

export { demoStrengthSets } from './demo';
