import { useEffect, useMemo } from 'react';
import { PERIOD_DAYS } from '@/shared/app/period';
import { useQuery } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';

import { getEngine, isEngineReady } from '@/shared/native/engine';
import { useEngineReady } from '@/shared/native/useEngineReady';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { useSyncState } from '@/shared/native/useSyncStatus';
import { SyncState, type ExerciseDetailData } from 'veloqrs';
import { CACHE } from '@/shared/app/constants';
import { queryKeys } from '@/shared/query/queryKeys';
import { useAuthStore } from '@/shared/app/AuthStore';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';
import { trailingWeekRanges } from '@/shared/time/trailingWeeks';

import { strengthTabState, type StrengthTabState } from '../lib/strengthTabState';
import { normalizeStrengthProgression, normalizeStrengthSummary } from '../lib/analysis';
import { demoStrengthSets } from '../demo';
import type { StrengthPeriod, StrengthScreenData } from '../types';

/**
 * Seed synthetic strength sets for demo activities once per session. The
 * Strength tab queries aggregate summaries directly (not per-activity) so
 * the demo-mode seed path in useExerciseSets doesn't cover this entry
 * point. Idempotent - bulk_insert_exercise_sets uses INSERT OR REPLACE.
 */
let demoStrengthSeedAttempted = false;

/** Whether anything was written, so a caller knows if there is news to announce. */
function ensureDemoStrengthSeeded(): boolean {
  if (demoStrengthSeedAttempted) return false;
  if (!useAuthStore.getState().isDemoMode) return false;
  const engine = getEngine();
  if (!isEngineReady()) return false;
  if (!engine || typeof engine.bulkInsertExerciseSets !== 'function') return false;
  demoStrengthSeedAttempted = true;
  let wrote = false;
  try {
    for (const [activityId, sets] of Object.entries(demoStrengthSets)) {
      if (engine.getExerciseSets(activityId).sets.length === 0) {
        engine.bulkInsertExerciseSets(activityId, sets);
        wrote = true;
      }
    }
  } catch (err) {
    console.warn('[StrengthVolume] demo seed failed:', err);
  }
  return wrote;
}

/**
 * Compute start/end timestamps for a period, rounded to start-of-day
 * so the values are stable within a day (prevents queryKey churn).
 */
export function getTimestampRange(period: StrengthPeriod): { startTs: number; endTs: number } {
  const now = new Date();
  // Round to end of today (23:59:59) so it's stable within the day
  now.setHours(23, 59, 59, 0);
  const endTs = localWallClockToEpochSeconds(now);

  // Today is one of the period's days, so `7d` is today and the six before
  // it: the same seven days as the trailing `This wk` bar.
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (PERIOD_DAYS[period] - 1));
  const startTs = localWallClockToEpochSeconds(start);

  return { startTs, endTs };
}

/** The trailing weeks, each with the label its bar carries. */
export function getTrailingWeekRanges(weekCount: number): {
  label: string;
  startTs: number;
  endTs: number;
}[] {
  return trailingWeekRanges(weekCount).map((range, position) => {
    const weeksBack = weekCount - 1 - position;
    return { label: weeksBack === 0 ? 'This wk' : `-${weeksBack}w`, ...range };
  });
}

/** How many trailing weeks a progression series covers. */
const PROGRESSION_WEEKS = 4;

/** Read the history surface through the existing strength engine boundary. */
export function readExerciseDetailData(category: number): ExerciseDetailData | null {
  return getEngine()?.getExerciseDetailData(category) ?? null;
}

/**
 * Everything the strength tab draws, read once.
 *
 * The period summary, the exercises behind every muscle and the trailing weeks
 * with their ranking are four aggregates of the same sets, so they come back
 * together. None of them depends on which muscle is selected, so a drag across
 * the body diagram issues no engine call: `selectProgression` and
 * `selectExercises` pick out of what is already in hand.
 */
export function useStrengthScreenData(period: StrengthPeriod) {
  // A parse commits sets the read could not see before, so it is stale at once.
  useEngineChannel('fitParsed', queryKeys.strength.all);
  return useQuery<StrengthScreenData | null>({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.strength.screenData(period, PROGRESSION_WEEKS),
    queryFn: () => {
      ensureDemoStrengthSeeded();
      const engine = getEngine();
      if (!engine || typeof engine.getStrengthScreenData !== 'function') return null;

      const { startTs, endTs } = getTimestampRange(period);
      const weeks = getTrailingWeekRanges(PROGRESSION_WEEKS);
      const data = engine.getStrengthScreenData(
        startTs,
        endTs,
        weeks.map((week) => ({ startTs: week.startTs, endTs: week.endTs }))
      );
      return {
        summary: normalizeStrengthSummary(data.summary),
        weeks,
        weekly: data.weekly.map((raw) => normalizeStrengthSummary(raw)),
        progressions: data.progressions.map((raw) => normalizeStrengthProgression(raw)),
        exercises: data.exercises.map((muscle) => ({
          muscleSlug: muscle.muscleSlug,
          exercises: muscle.exercises.map((exercise) => ({
            exerciseName: exercise.exerciseName,
            exerciseCategory: exercise.exerciseCategory,
            totalSets: exercise.totalSets,
            totalReps: exercise.totalReps,
            volumeKg: exercise.volumeKg,
            activityCount: exercise.activityCount,
            isPrimary: exercise.isPrimary,
          })),
        })),
        owedCount: data.owedCount,
      };
    },
    staleTime: Infinity,
    gcTime: CACHE.LONG, // 30 minutes
  });
}

/**
 * Whether the Strength tab is shown, and whether it has anything to draw yet.
 * Memoised to avoid redundant FFI calls on every render.
 */
export function useStrengthTabState(): StrengthTabState {
  // `fitParsed` as well as `activities`: a FIT landing is what turns an
  // awaiting tab into a ready one, and it is the only signal the demo seed
  // below sends.
  const readStrength = useEngineRead(['activities', 'fitParsed']);
  const engine = useEngineReady();
  const isSyncing = useSyncState() === SyncState.Syncing;

  // The demo seed is a write, and a write does not belong in a render. It still
  // has to land before the first `hasStrengthData` answer or the tab never
  // appears, so it runs here instead: the memo reads 'hidden' for one render,
  // the seed announces on `fitParsed`, and the subscription above brings the
  // real answer. `bulk_insert_exercise_sets` notifies for exactly this reason
  // and says so in `objects/strength.rs`, so nothing has to be wired up
  // by hand. Non-demo sessions, and every mount after the first in a process,
  // do nothing at all.
  useEffect(() => {
    if (!engine) return;
    ensureDemoStrengthSeeded();
  }, [engine]);

  return useMemo(
    () =>
      readStrength((open) => {
        if (typeof open.hasStrengthData !== 'function') return 'hidden' as StrengthTabState;
        try {
          // The engine's own queue: every strength activity with no recorded
          // FIT outcome.
          const unfetchedCount =
            typeof open.getUnprocessedStrengthIds === 'function'
              ? open.getUnprocessedStrengthIds().length
              : 0;
          return strengthTabState({ hasSets: open.hasStrengthData(), unfetchedCount, isSyncing });
        } catch {
          return 'hidden' as StrengthTabState;
        }
      }) ?? 'hidden',
    [readStrength, isSyncing]
  );
}
