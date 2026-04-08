import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { buildStrengthProgression } from '@/lib/strength/analysis';
import type {
  StrengthSummary,
  StrengthPeriod,
  MuscleExerciseSummary,
  ExerciseActivity,
  StrengthProgression,
} from '@/types';

/**
 * Compute start/end timestamps for a period, rounded to start-of-day
 * so the values are stable within a day (prevents queryKey churn).
 */
function getTimestampRange(period: StrengthPeriod): { startTs: number; endTs: number } {
  const now = new Date();
  // Round to end of today (23:59:59) so it's stable within the day
  now.setHours(23, 59, 59, 0);
  const endTs = Math.floor(now.getTime() / 1000);

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (period) {
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    case '4weeks':
      start.setDate(start.getDate() - 28);
      break;
    case '3months':
      start.setMonth(start.getMonth() - 3);
      break;
    case '6months':
      start.setMonth(start.getMonth() - 6);
      break;
  }
  const startTs = Math.floor(start.getTime() / 1000);

  return { startTs, endTs };
}

function getTrailingWeekRanges(weekCount: number): Array<{
  label: string;
  startTs: number;
  endTs: number;
}> {
  const end = new Date();
  end.setHours(23, 59, 59, 0);

  const ranges: Array<{ label: string; startTs: number; endTs: number }> = [];
  for (let index = weekCount - 1; index >= 0; index -= 1) {
    const rangeEnd = new Date(end);
    rangeEnd.setDate(rangeEnd.getDate() - index * 7);

    const rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 6);
    rangeStart.setHours(0, 0, 0, 0);

    ranges.push({
      label: index === 0 ? 'This wk' : `-${index}w`,
      startTs: Math.floor(rangeStart.getTime() / 1000),
      endTs: Math.floor(rangeEnd.getTime() / 1000),
    });
  }

  return ranges;
}

function normalizeStrengthSummary(raw: {
  muscleVolumes?: Array<{
    slug: string;
    primarySets: number;
    secondarySets: number;
    weightedSets: number;
    totalReps: number;
    totalWeightKg: number;
    exerciseNames: string[];
  }>;
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
    queryKey: ['strength-volume', period],
    queryFn: () => {
      const { startTs, endTs } = getTimestampRange(period);
      const engine = getRouteEngine();
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
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
  });
}

/**
 * Fetch a trailing 4-week progression series for one muscle group.
 * Compares the recent two weeks against the prior two weeks.
 */
export function useStrengthProgression(muscleSlug: string | null) {
  return useQuery<StrengthProgression | null>({
    queryKey: ['strength-progression', muscleSlug],
    queryFn: () => {
      const engine = getRouteEngine();
      if (!engine || !muscleSlug || typeof engine.getStrengthSummary !== 'function') {
        return null;
      }

      try {
        const points = getTrailingWeekRanges(4).map((range) => {
          const summary = normalizeStrengthSummary(
            engine.getStrengthSummary(range.startTs, range.endTs)
          );
          const match = summary.muscleVolumes.find((volume) => volume.slug === muscleSlug);

          return {
            label: range.label,
            startTs: range.startTs,
            endTs: range.endTs,
            weightedSets: match?.weightedSets ?? 0,
            activityCount: summary.activityCount,
          };
        });

        return buildStrengthProgression(muscleSlug, points);
      } catch (err) {
        console.error('[StrengthProgression] Error:', err);
        return null;
      }
    },
    enabled: !!muscleSlug,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

/**
 * Fetch exercise summaries for a specific muscle group within a period.
 * Returns exercises sorted by activity count, with frequency and volume stats.
 */
export function useExercisesForMuscle(period: StrengthPeriod, muscleSlug: string | null) {
  return useQuery<MuscleExerciseSummary>({
    queryKey: ['exercises-for-muscle', period, muscleSlug],
    queryFn: () => {
      const { startTs, endTs } = getTimestampRange(period);
      const engine = getRouteEngine();
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
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
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
    queryKey: ['activities-for-exercise', period, muscleSlug, exerciseCategory],
    queryFn: () => {
      const { startTs, endTs } = getTimestampRange(period);
      const engine = getRouteEngine();
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
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

/**
 * Check if any strength training data exists in the engine.
 * Memoized to avoid redundant FFI calls on every render.
 */
export function useHasStrengthData(): boolean {
  const [engineVersion, setEngineVersion] = useState(0);

  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;

    const unsubscribe = engine.subscribe('activities', () => {
      setEngineVersion((v) => v + 1);
    });

    return unsubscribe;
  }, []);

  return useMemo(() => {
    const engine = getRouteEngine();
    if (!engine || typeof engine.hasStrengthData !== 'function') return false;
    try {
      return engine.hasStrengthData();
    } catch {
      return false;
    }
  }, [engineVersion]);
}
