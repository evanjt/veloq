export { BodyPairWithLoupe } from './components/BodyPairWithLoupe';
export { ExercisePicker } from './components/ExercisePicker';
export { ExerciseTable } from './components/ExerciseTable';
export { MuscleGroupView } from './components/MuscleGroupView';
export { StrengthActivityCard, type StrengthCardData } from './components/StrengthActivityCard';
export { StrengthCardBodies } from './components/StrengthCardBodies';
export { StrengthBodyDiagram, StrengthBodyDiagramSkeleton } from './components/StrengthBodyDiagram';
export { StrengthProgressionCard } from './components/StrengthProgressionCard';
export { StrengthExerciseList } from './components/StrengthExerciseList';
export { default as ExerciseDetailScreen } from './components/ExerciseDetailScreen';
export { StrengthBalanceView } from './components/StrengthBalanceView';
export { StrengthBalanceScale } from './components/StrengthBalanceScale';
export { StrengthPairsInfoSheet } from './components/StrengthPairsInfoSheet';

export { useExerciseSets, useStrengthCardData } from './hooks/useExerciseSets';
export {
  useOwedStrengthFiles,
  useStrengthScreenData,
  useStrengthTabState,
} from './hooks/useStrengthScreenData';
export { generateStrengthInsights } from './hooks/strengthInsights';
export { STRENGTH_PERIODS, strengthPeriodOf } from './periods';

export { BODY_INTRINSIC_W } from './lib/bodyScale';
export { type MuscleSlug } from './lib/exerciseMuscleMap';
export { muscleName, balancePairName } from './lib/muscleNames';
export {
  buildStrengthBalancePairs,
  normaliseStrengthProgression,
  normaliseStrengthSummary,
  selectExercises,
  selectProgression,
} from './lib/analysis';

export type { StrengthSummary, StrengthProgressionRecord } from './types';
