/**
 * Hook for section merge operations: finding candidates and executing merges.
 */

import { useCallback } from 'react';
import { getEngine } from '@/shared/native/engine';
import { useTranslation } from 'react-i18next';
import type { MergeDropped } from 'veloqrs';
import { announceDepartedRides } from '../lib/departedRides';

interface UseMergeSectionsResult {
  /** Merge secondary section into primary. Returns merged section ID or null. */
  merge: (primaryId: string, secondaryId: string) => string | null;
  /**
   * The donor rides a merge would leave out of the kept section. A failed
   * read is an empty list, so the dialog says nothing it cannot back.
   */
  previewDropped: (primaryId: string, secondaryId: string) => MergeDropped[];
}

export function useMergeSections(): UseMergeSectionsResult {
  const { t } = useTranslation();

  const merge = useCallback(
    (primaryId: string, secondaryId: string): string | null => {
      const engine = getEngine();
      if (!engine) return null;
      const outcome = engine.mergeSections(primaryId, secondaryId);
      if (!outcome) return null;
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

  return { merge, previewDropped };
}
