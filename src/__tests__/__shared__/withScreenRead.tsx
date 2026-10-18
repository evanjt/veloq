/**
 * Mounts a calendar card the way the fitness screen does: the screen makes the
 * one fitness screen read and hands each card its part.
 *
 *   render(<WithScreenRead>{(training) => <ActivityHeatmap training={training} />}</WithScreenRead>);
 */
import React from 'react';

import { useFitnessScreenRead } from '@/features/fitness/hooks/useFitnessScreenRead';
import type { TrainingCardsRead } from '@/features/stats/hooks/useEngineStats';

export function WithScreenRead({
  children,
}: {
  children: (training: TrainingCardsRead) => React.ReactNode;
}) {
  const { training } = useFitnessScreenRead();
  return <>{children(training)}</>;
}
