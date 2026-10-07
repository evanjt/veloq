export { BodyPairWithLoupe } from './components/BodyPairWithLoupe';
export { ExerciseTable } from './components/ExerciseTable';
export { MuscleGroupView } from './components/MuscleGroupView';
export { StrengthActivityCard, type StrengthCardData } from './components/StrengthActivityCard';
export { StrengthBodyDiagram } from './components/StrengthBodyDiagram';
export { StrengthProgressionCard } from './components/StrengthProgressionCard';
export { StrengthExerciseList } from './components/StrengthExerciseList';
export { default as ExerciseDetailScreen } from './components/ExerciseDetailScreen';
export { StrengthBalanceView } from './components/StrengthBalanceView';

export { useExerciseSets, useMuscleGroups } from './hooks/useExerciseSets';
export { useMuscleDetail } from './hooks/useMuscleDetail';
export type { MuscleGroupDetail } from './hooks/useMuscleDetail';
export {
  useStrengthScreenData,
  useStrengthTabState,
  readExerciseDetailData,
} from './hooks/useStrengthScreenData';
export { generateStrengthInsights } from './hooks/strengthInsights';
export { STRENGTH_PERIODS } from './periods';

export { type MuscleSlug } from './lib/exerciseMuscleMap';
export { MUSCLE_NAME_KEYS, muscleName, balancePairName } from './lib/muscleNames';
export {
  buildStrengthBalancePairs,
  normalizeStrengthProgression,
  normalizeStrengthSummary,
  selectExercises,
  selectProgression,
  listBalancePairNames,
} from './lib/analysis';
export { formatSetCount, formatBalanceRatio } from './lib/formatting';
export { findMuscleAtPoint } from './lib/polygons';
export type { MusclePolygons, Polygon } from './lib/polygons';

export type {
  MuscleVolume,
  StrengthSummary,
  StrengthProgressionRecord,
  StrengthPeriod,
  StrengthProgressPoint,
  StrengthProgressTrend,
  StrengthProgression,
  StrengthScreenData,
  StrengthBalanceStatus,
  StrengthBalancePair,
  ExerciseSummary,
  MuscleExerciseSummary,
} from './types';

export { demoStrengthSets } from './demo';
