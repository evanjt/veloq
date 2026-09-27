import { useEffect, useMemo } from 'react';
import { PERIOD_DAYS } from '@/shared/app/period';
import { useQuery } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';
import { useEngineReady } from '@/shared/native/useEngineReady';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { CACHE } from '@/shared/app/constants';
import { queryKeys } from '@/shared/query/queryKeys';
import { useAuthStore } from '@/shared/app/AuthStore';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';

import { strengthTabState, type StrengthTabState } from '../lib/strengthTabState';
import { normalizeStrengthProgression } from '../lib/analysis';
import { demoStrengthSets } from '../demo';
import type {
  StrengthSummary,
  StrengthBalanceStatus,
  StrengthPeriod,
  StrengthScreenData,
  ExerciseActivity,
} from '../types';

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
  if (!engine || typeof engine.bulkInsertExerciseSets !== 'function') return false;
  demoStrengthSeedAttempted = true;
  let wrote = false;
  try {
    for (const [activityId, sets] of Object.entries(demoStrengthSets)) {
      if (engine.getExerciseSets(activityId).length === 0) {
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

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - PERIOD_DAYS[period]);
  const startTs = localWallClockToEpochSeconds(start);

  return { startTs, endTs };
}

export function getTrailingWeekRanges(weekCount: number): {
  label: string;
  startTs: number;
  endTs: number;
}[] {
  const end = new Date();
  end.setHours(23, 59, 59, 0);

  const ranges: { label: string; startTs: number; endTs: number }[] = [];
  for (let index = weekCount - 1; index >= 0; index -= 1) {
    const rangeEnd = new Date(end);
    rangeEnd.setDate(rangeEnd.getDate() - index * 7);

    const rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 6);
    rangeStart.setHours(0, 0, 0, 0);

    ranges.push({
      label: index === 0 ? 'This wk' : `-${index}w`,
      startTs: localWallClockToEpochSeconds(rangeStart),
      endTs: localWallClockToEpochSeconds(rangeEnd),
    });
  }

  return ranges;
}

function normalizeStrengthSummary(raw: {
  muscleVolumes?: {
    slug: string;
    primarySets: number;
    secondarySets: number;
    weightedSets: number;
    totalReps: number;
    totalWeightKg: number;
    exerciseNames: string[];
  }[];
  activityCount?: number;
  totalSets?: number;
  balance?: {
    id: string;
    leftSlug: string;
    rightSlug: string;
    leftWeightedSets: number;
    rightWeightedSets: number;
    dominantSlug?: string | null;
    ratio?: number | null;
    status: string;
  }[];
}): StrengthSummary {
  return {
    muscleVolumes: (raw.muscleVolumes ?? []).map((v) => ({
      slug: v.slug,
      primarySets: v.primarySets,
      secondarySets: v.secondarySets,
      weightedSets: v.weightedSets,
      totalReps: v.totalReps,
      totalWeightKg: v.totalWeightKg,
      exerciseNames: v.exerciseNames,
    })),
    activityCount: raw.activityCount ?? 0,
    totalSets: raw.totalSets ?? 0,
    balance: (raw.balance ?? []).map((pair) => ({
      id: pair.id,
      leftSlug: pair.leftSlug,
      rightSlug: pair.rightSlug,
      leftWeightedSets: pair.leftWeightedSets,
      rightWeightedSets: pair.rightWeightedSets,
      dominantSlug: pair.dominantSlug ?? null,
      ratio: pair.ratio ?? null,
      status: pair.status as StrengthBalanceStatus,
    })),
  };
}

/** How many trailing weeks a progression series covers. */
const PROGRESSION_WEEKS = 4;

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
  return useQuery<StrengthScreenData | null>({
    queryKey: queryKeys.strength.screenData(period, PROGRESSION_WEEKS),
    queryFn: () => {
      ensureDemoStrengthSeeded();
      const engine = getEngine();
      if (!engine || typeof engine.getStrengthScreenData !== 'function') return null;

      try {
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
              frequencyDays: exercise.frequencyDays,
              totalSets: exercise.totalSets,
              totalWeightKg: exercise.totalWeightKg,
              activityCount: exercise.activityCount,
              isPrimary: exercise.isPrimary,
            })),
          })),
          periodDays: data.periodDays,
        };
      } catch (err) {
        console.error('[StrengthScreen] Error:', err);
        return null;
      }
    },
    staleTime: CACHE.SHORT, // 5 minutes
    gcTime: CACHE.LONG, // 30 minutes
  });
}

/**
 * Fetch activities for a specific exercise filtered by muscle group.
 * Returns activities sorted by date descending with per-activity stats.
 */
export function useActivitiesForExercise(
  period: StrengthPeriod,
  muscleSlug: string | null,
  exerciseCategory: number | null
) {
  return useQuery<ExerciseActivity[]>({
    queryKey: queryKeys.strength.activitiesForExercise(period, muscleSlug, exerciseCategory),
    queryFn: () => {
      const { startTs, endTs } = getTimestampRange(period);
      const engine = getEngine();
      if (
        !engine ||
        !muscleSlug ||
        exerciseCategory == null ||
        typeof engine.getActivitiesForExercise !== 'function'
      ) {
        return [];
      }

      try {
        const raw = engine.getActivitiesForExercise(startTs, endTs, muscleSlug, exerciseCategory);
        return (raw.activities ?? []).map(
          (a: {
            activityId: string;
            activityName: string;
            date: number | bigint;
            sets: number;
            totalWeightKg: number;
            isPrimary: boolean;
          }) => ({
            activityId: a.activityId,
            activityName: a.activityName,
            date: typeof a.date === 'bigint' ? Number(a.date) : a.date,
            sets: a.sets,
            totalWeightKg: a.totalWeightKg,
            isPrimary: a.isPrimary,
          })
        );
      } catch (err) {
        console.error('[ActivitiesForExercise] Error:', err);
        return [];
      }
    },
    enabled: !!muscleSlug && exerciseCategory != null,
    staleTime: CACHE.SHORT,
    gcTime: CACHE.LONG,
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
          // The empty list asks the engine for its own queue: every strength
          // activity with no recorded FIT outcome.
          const unfetchedCount =
            typeof open.getUnprocessedStrengthIds === 'function'
              ? open.getUnprocessedStrengthIds([]).length
              : 0;
          return strengthTabState({ hasSets: open.hasStrengthData(), unfetchedCount });
        } catch {
          return 'hidden' as StrengthTabState;
        }
      }) ?? 'hidden',
    [readStrength]
  );
}
