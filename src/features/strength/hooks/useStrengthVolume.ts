import { useState, useEffect, useMemo } from 'react';
import { PERIOD_DAYS } from '@/shared/app/period';
import { useQuery } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';
import { useEngineReady } from '@/shared/native/useEngineReady';
import { CACHE } from '@/shared/app/constants';
import { queryKeys } from '@/shared/query/queryKeys';
import { useAuthStore } from '@/shared/app/AuthStore';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';

import { strengthTabState, type StrengthTabState } from '../lib/strengthTabState';
import { buildStrengthProgression } from '../lib/analysis';
import { demoStrengthSets } from '../demo';
import type {
  StrengthSummary,
  StrengthPeriod,
  MuscleExerciseSummary,
  ExerciseActivity,
  StrengthProgression,
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
  };
}

/**
 * Fetch aggregated strength volume for a time period.
 * Returns muscle group volumes with weighted set counting.
 */
export function useStrengthVolume(period: StrengthPeriod) {
  return useQuery<StrengthSummary>({
    queryKey: queryKeys.strength.volume(period),
    queryFn: () => {
      ensureDemoStrengthSeeded();
      const { startTs, endTs } = getTimestampRange(period);
      const engine = getEngine();
      if (!engine || typeof engine.getStrengthSummary !== 'function') {
        return { muscleVolumes: [], activityCount: 0, totalSets: 0 };
      }

      try {
        return normalizeStrengthSummary(engine.getStrengthSummary(startTs, endTs));
      } catch (err) {
        console.error('[StrengthVolume] Error:', err);
        return { muscleVolumes: [], activityCount: 0, totalSets: 0 };
      }
    },
    staleTime: CACHE.SHORT, // 5 minutes
    gcTime: CACHE.LONG, // 30 minutes
  });
}

/** How many trailing weeks a progression series covers. */
const PROGRESSION_WEEKS = 4;

interface TrailingWeeks {
  ranges: ReturnType<typeof getTrailingWeekRanges>;
  summaries: StrengthSummary[];
}

/**
 * The trailing weeks behind every muscle's progression, read once.
 *
 * `getStrengthSummaryBatch` returns each range grouped by muscle already, so
 * the read never depended on which muscle was selected. Keying it on the muscle
 * meant a drag across the body diagram paid four range reads for every muscle
 * it crossed, each one re-reading the same weeks, for four numbers the previous
 * read had already returned.
 */
function useTrailingWeekSummaries(enabled: boolean) {
  return useQuery<TrailingWeeks | null>({
    queryKey: queryKeys.strength.trailingWeeks(PROGRESSION_WEEKS),
    queryFn: () => {
      const engine = getEngine();
      if (!engine || typeof engine.getStrengthSummaryBatch !== 'function') return null;

      try {
        const ranges = getTrailingWeekRanges(PROGRESSION_WEEKS);
        const rawSummaries = engine.getStrengthSummaryBatch(
          ranges.map((r) => ({ startTs: r.startTs, endTs: r.endTs }))
        );
        return { ranges, summaries: rawSummaries.map((raw) => normalizeStrengthSummary(raw)) };
      } catch (err) {
        console.error('[StrengthProgression] Error:', err);
        return null;
      }
    },
    enabled,
    staleTime: CACHE.SHORT,
    gcTime: CACHE.LONG,
  });
}

/**
 * A trailing 4-week progression series for one muscle group, compared two weeks
 * against the prior two, derived from the one trailing-weeks read above.
 */
export function useStrengthProgression(muscleSlug: string | null) {
  const query = useTrailingWeekSummaries(!!muscleSlug);

  const data = useMemo<StrengthProgression | null>(() => {
    if (!muscleSlug || !query.data) return null;
    const { ranges, summaries } = query.data;
    const points = ranges.map((range, idx) => {
      const summary = summaries[idx];
      const match = summary?.muscleVolumes.find((volume) => volume.slug === muscleSlug);
      return {
        label: range.label,
        startTs: range.startTs,
        endTs: range.endTs,
        weightedSets: match?.weightedSets ?? 0,
        activityCount: summary?.activityCount ?? 0,
      };
    });
    return buildStrengthProgression(muscleSlug, points);
  }, [muscleSlug, query.data]);

  return { ...query, data };
}

/**
 * Fetch exercise summaries for a specific muscle group within a period.
 * Returns exercises sorted by activity count, with frequency and volume stats.
 */
export function useExercisesForMuscle(period: StrengthPeriod, muscleSlug: string | null) {
  return useQuery<MuscleExerciseSummary>({
    queryKey: queryKeys.strength.exercisesForMuscle(period, muscleSlug),
    queryFn: () => {
      const { startTs, endTs } = getTimestampRange(period);
      const engine = getEngine();
      if (!engine || !muscleSlug || typeof engine.getExercisesForMuscle !== 'function') {
        return { exercises: [], periodDays: 0 };
      }

      try {
        const raw = engine.getExercisesForMuscle(startTs, endTs, muscleSlug);
        return {
          exercises: (raw.exercises ?? []).map(
            (e: {
              exerciseName: string;
              exerciseCategory: number;
              frequencyDays: number;
              totalSets: number;
              totalWeightKg: number;
              activityCount: number;
              isPrimary: boolean;
            }) => ({
              exerciseName: e.exerciseName,
              exerciseCategory: e.exerciseCategory,
              frequencyDays: e.frequencyDays,
              totalSets: e.totalSets,
              totalWeightKg: e.totalWeightKg,
              activityCount: e.activityCount,
              isPrimary: e.isPrimary,
            })
          ),
          periodDays: raw.periodDays ?? 0,
        };
      } catch (err) {
        console.error('[ExercisesForMuscle] Error:', err);
        return { exercises: [], periodDays: 0 };
      }
    },
    enabled: !!muscleSlug,
    staleTime: CACHE.SHORT,
    gcTime: CACHE.LONG,
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
  const [engineVersion, setEngineVersion] = useState(0);
  const engine = useEngineReady();

  useEffect(() => {
    if (!engine) return undefined;
    let cancelled = false;

    // No bump on arrival: `engine` changing is itself a render, and the memo
    // below reads it.
    const wake = () => {
      if (!cancelled) setEngineVersion((v) => v + 1);
    };
    // `fitParsed` as well as `activities`: a FIT landing is what turns an
    // awaiting tab into a ready one, and it is the only signal the demo seed
    // below sends.
    const unsubscribes = [
      engine.subscribe('activities', wake),
      engine.subscribe('fitParsed', wake),
    ];

    return () => {
      cancelled = true;
      unsubscribes.forEach((u) => u?.());
    };
  }, [engine]);

  // The demo seed is a write, and a write does not belong in a render. It still
  // has to land before the first `hasStrengthData` answer or the tab never
  // appears, so it runs here instead: the memo reads 'hidden' for one render,
  // the seed announces on `fitParsed`, and the subscription above brings the
  // real answer. `bulk_insert_exercise_sets` notifies for exactly this reason
  // and says so (`objects/strength.rs:572-574`), so nothing has to be wired up
  // by hand. Non-demo sessions, and every mount after the first in a process,
  // do nothing at all.
  useEffect(() => {
    if (!engine) return;
    ensureDemoStrengthSeeded();
  }, [engine]);

  return useMemo(() => {
    if (!engine || typeof engine.hasStrengthData !== 'function') return 'hidden';
    try {
      // The empty list asks the engine for its own queue: every strength
      // activity with no recorded FIT outcome.
      const unfetchedCount =
        typeof engine.getUnprocessedStrengthIds === 'function'
          ? engine.getUnprocessedStrengthIds([]).length
          : 0;
      return strengthTabState({ hasSets: engine.hasStrengthData(), unfetchedCount });
    } catch {
      return 'hidden';
    }
  }, [engine, engineVersion]);
}
