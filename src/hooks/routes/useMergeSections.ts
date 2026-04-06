/**
 * Hook for section merge operations: finding candidates and executing merges.
 */

import { useState, useMemo, useCallback } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from './useRouteEngine';
import type { MergeCandidate } from 'veloqrs';

interface UseMergeSectionsResult {
  /** Sections that are candidates for merging with the given section. */
  candidates: MergeCandidate[];
  /** Merge secondary section into primary. Returns merged section ID or null. */
  merge: (primaryId: string, secondaryId: string) => string | null;
  /** Whether a merge is currently in progress. */
  isMerging: boolean;
}

export function useMergeSections(sectionId: string | undefined): UseMergeSectionsResult {
  const trigger = useEngineSubscription(['sections']);
  const [isMerging, setIsMerging] = useState(false);

  const candidates = useMemo(() => {
    if (!sectionId) return [];
    const engine = getRouteEngine();
    if (!engine) return [];
    return engine.getMergeCandidates(sectionId);
  }, [sectionId, trigger]);

  const merge = useCallback((primaryId: string, secondaryId: string): string | null => {
    const engine = getRouteEngine();
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
