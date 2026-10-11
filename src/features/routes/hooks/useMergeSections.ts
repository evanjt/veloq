/**
 * Hook for section merge operations: finding candidates and executing merges.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { getEngine } from '@/shared/native/engine';
import { useTranslation } from 'react-i18next';
import type { FfiMergeOutcome, MergeDropped } from 'veloqrs';
import { announceDepartedRides } from '../lib/departedRides';

interface UseMergeSectionsResult {
  /**
   * Merge secondary section into primary. Resolves with the kept section's ID,
   * or null when the merge failed or another merge was still running.
   */
  merge: (primaryId: string, secondaryId: string) => Promise<string | null>;
  /** True while a merge runs; a second merge is refused until it ends. */
  isMerging: boolean;
  /**
   * The donor rides a merge would leave out of the kept section. A failed
   * read is an empty list, so the dialog says nothing it cannot back.
   */
  previewDropped: (primaryId: string, secondaryId: string) => MergeDropped[];
}

export function useMergeSections(): UseMergeSectionsResult {
  const { t } = useTranslation();
  const [isMerging, setIsMerging] = useState(false);
  const mergeInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A merge re-matches the rides of both sections, so it runs off the JS
  // thread. One runs at a time, and a tap while it runs is refused rather
  // than queued.
  const merge = useCallback(
    async (primaryId: string, secondaryId: string): Promise<string | null> => {
      const engine = getEngine();
      if (!engine || mergeInFlight.current) return null;
      mergeInFlight.current = true;
      setIsMerging(true);

      let outcome: FfiMergeOutcome | null = null;
      try {
        outcome = await engine.runSectionMerge(primaryId, secondaryId);
      } catch {
        outcome = null;
      } finally {
        mergeInFlight.current = false;
        if (mounted.current) setIsMerging(false);
      }

      if (!outcome) {
        Alert.alert(t('common.error'), t('sections.mergeFailed'));
        return null;
      }
      announceDepartedRides(outcome.departed, t);
      return outcome.sectionId;
    },
    [t]
  );

  const previewDropped = useCallback(
    (primaryId: string, secondaryId: string): MergeDropped[] =>
      getEngine()?.mergePreview(primaryId, secondaryId) ?? [],
    []
  );

  return { merge, isMerging, previewDropped };
}
