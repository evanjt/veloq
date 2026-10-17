import type { SeriesSample } from '@/features/insights';
import type { ExerciseDetailData } from 'veloqrs';

/**
 * The estimated one-rep max of each session that has one, on the session's
 * date, so the chart spaces two sessions by the days between them. A session
 * with no estimate is left out rather than drawn at zero.
 */
export function exerciseTrendSamples(
  sessions: readonly ExerciseDetailData['sessions'][number][]
): SeriesSample[] {
  return sessions.flatMap((session) =>
    session.estimatedOneRepMaxKg == null
      ? []
      : [{ value: session.estimatedOneRepMaxKg, date: session.date }]
  );
}
