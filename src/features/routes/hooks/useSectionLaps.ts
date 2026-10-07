/**
 * Per-lap exclusion on a section: the two actions that move one traversal,
 * addressed by `activityId` and `startIndex` the way the engine's junction
 * rows are. Which laps are excluded is not held here: the screen read carries
 * every lap with its `excluded` flag.
 */

import { useCallback } from 'react';
import { getEngine } from '@/shared/native/engine';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

export interface SectionLaps {
  excludeLap: (activityId: string, startIndex: number) => void;
  includeLap: (activityId: string, startIndex: number) => void;
}

export function useSectionLaps(sectionId: string | undefined): SectionLaps {
  const excludeLap = useCallback(
    (activityId: string, startIndex: number) => {
      const engine = getEngine();
      if (!engine || !sectionId) return;
      engine.excludeSectionLap(sectionId, activityId, startIndex);
    },
    [sectionId]
  );
  const includeLap = useCallback(
    (activityId: string, startIndex: number) => {
      const engine = getEngine();
      if (!engine || !sectionId) return;
      engine.includeSectionLap(sectionId, activityId, startIndex);
    },
    [sectionId]
  );

  return { excludeLap, includeLap };
}

/**
 * Whether any activity has some, but not all, of its laps excluded: the
 * state the section badge names. Read off the lap list's records, which hold
 * the excluded laps flagged.
 */
export function hasPartialExclusion(records: SectionPerformanceRecord[]): boolean {
  return records.some((r) => {
    if (r.laps.length < 2) return false;
    const out = r.laps.filter((l) => l.excluded).length;
    return out > 0 && out < r.laps.length;
  });
}
