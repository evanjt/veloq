/**
 * Hook for section merge operations: finding candidates and executing merges.
 */

import { useState, useCallback } from 'react';
import { getEngine } from '@/shared/native/engine';
import type { MergeCandidate } from 'veloqrs';

interface UseMergeSectionsResult {
  /** Sections that are candidates for merging with the given section. */
  candidates: MergeCandidate[];
  /** Merge secondary section into primary. Returns merged section ID or null. */
  merge: (primaryId: string, secondaryId: string) => string | null;
  /** Whether a merge is currently in progress. */
  isMerging: boolean;
}

/**
 * The candidates come from `getSectionDetailData`, which the screen reads before
 * it mounts this hook.
 */
export function useMergeSections(candidates: MergeCandidate[]): UseMergeSectionsResult {
  const [isMerging, setIsMerging] = useState(false);

  const merge = useCallback((primaryId: string, secondaryId: string): string | null => {
    const engine = getEngine();
    if (!engine) return null;
    setIsMerging(true);
    try {
      return engine.mergeSections(primaryId, secondaryId);
    } finally {
      setIsMerging(false);
    }
  }, []);

  return { candidates, merge, isMerging };
}
