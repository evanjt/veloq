/**
 * Per-lap exclusion on a section: which traversals the user has excluded,
 * and the two actions that move one. Keyed by `activityId:startIndex`, the
 * way the engine's junction rows are.
 */

import { useCallback, useMemo, useState } from 'react';
import { getEngine } from '@/shared/native/engine';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

export function lapKey(activityId: string, startIndex: number): string {
  return `${activityId}:${startIndex}`;
}

export interface SectionLaps {
  excludedLaps: Set<string>;
  excludeLap: (activityId: string, startIndex: number) => void;
  includeLap: (activityId: string, startIndex: number) => void;
}

/**
 * `bundledLaps` lets a caller that already read them as part of a screen
 * bundle skip this hook's own FFI call. An empty array is an answer, so only
 * `undefined` falls back to reading.
 */
export function useSectionLaps(
  sectionId: string | undefined,
  refreshKey = 0,
  bundledLaps?: readonly { activityId: string; startIndex: number }[]
): SectionLaps {
  const [tick, setTick] = useState(0);
  const excludedLaps = useMemo(() => {
    // An action bumps `tick`, and the bundle behind it has not been re-read,
    // so the hook goes back to the engine once the user moves a lap.
    const laps =
      bundledLaps !== undefined && tick === 0
        ? bundledLaps
        : sectionId
          ? getEngine()?.getExcludedSectionLaps(sectionId)
          : undefined;
    if (!laps) return new Set<string>();
    return new Set(laps.map((l) => lapKey(l.activityId, l.startIndex)));
  }, [sectionId, refreshKey, tick, bundledLaps]);

  const excludeLap = useCallback(
    (activityId: string, startIndex: number) => {
      const engine = getEngine();
      if (!engine || !sectionId) return;
      if (engine.excludeSectionLap(sectionId, activityId, startIndex)) setTick((k) => k + 1);
    },
    [sectionId]
  );
  const includeLap = useCallback(
    (activityId: string, startIndex: number) => {
      const engine = getEngine();
      if (!engine || !sectionId) return;
      if (engine.includeSectionLap(sectionId, activityId, startIndex)) setTick((k) => k + 1);
    },
    [sectionId]
  );

  return { excludedLaps, excludeLap, includeLap };
}

/**
 * Whether any activity has some, but not all, of its laps excluded: the
 * state the section badge names.
 */
export function hasPartialExclusion(
  records: SectionPerformanceRecord[],
  excludedLaps: Set<string>
): boolean {
  return records.some((r) => {
    if (r.laps.length < 2) return false;
    const out = r.laps.filter((l) => excludedLaps.has(lapKey(l.activityId, l.startIndex))).length;
    return out > 0 && out < r.laps.length;
  });
}

/**
 * Heart rate is written per lap only where a stream covered the traversal, and
 * on the private corpus that is 209 of 6,587 laps. An average over the covered
 * laps alone is honest only if it says how many it had, so the coverage travels
 * with the number rather than being recomputed at the chip. It sits beside
 * `hasPartialExclusion` because it is the same shape of question: one answer
 * over every lap the records hold.
 */
export interface SectionHeartRate {
  bpm: number;
  /** Laps the mean was taken over. */
  laps: number;
  /** Laps there were, covered or not. */
  ofLaps: number;
}

export function sectionHeartRate(records: SectionPerformanceRecord[]): SectionHeartRate | null {
  const all = records.flatMap((r) => r.laps);
  const values = all.filter((l) => l.avgHr != null && l.avgHr > 0).map((l) => l.avgHr as number);
  if (values.length === 0) return null;
  return {
    bpm: values.reduce((a, b) => a + b, 0) / values.length,
    laps: values.length,
    ofLaps: all.length,
  };
}
