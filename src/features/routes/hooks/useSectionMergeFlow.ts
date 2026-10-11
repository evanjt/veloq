import { useCallback, useRef } from 'react';
import { router } from 'expo-router';
import type { MergeCandidate } from 'veloqrs';

import { useSheetOpener } from '@/shared/app/sheetRequest';
import {
  type MergeCandidatesSheetInput,
  type MergeConfirmSheetInput,
  type MergeConfirmSheetResult,
  type MergeSectionInfo,
} from '../lib/mergeSheets';
import { useMergeSections } from './useMergeSections';

interface UseSectionMergeFlowArgs {
  section: (Omit<MergeSectionInfo, 'name'> & { name?: string | undefined }) | null | undefined;
  candidates: MergeCandidate[];
}

/**
 * Starts the merge of a section into one of its candidates. Several candidates open the
 * candidates sheet first, one goes straight to the confirmation sheet, and a dismissal at either
 * ends the flow with nothing merged. A merge that leaves another section standing moves to it.
 */
export function useSectionMergeFlow({
  section,
  candidates,
}: UseSectionMergeFlowArgs): () => Promise<void> {
  const openSheet = useSheetOpener();
  const { merge } = useMergeSections();
  const running = useRef(false);

  return useCallback(async () => {
    const [only] = candidates;
    if (!section || !only || running.current) return;
    running.current = true;
    try {
      let target = only;
      if (candidates.length > 1) {
        const picked = await openSheet<MergeCandidatesSheetInput, MergeCandidate>(
          'sheets/merge-candidates',
          { candidates }
        );
        if (picked.kind !== 'selected') return;
        target = picked.value;
      }
      const confirmation = await openSheet<MergeConfirmSheetInput, MergeConfirmSheetResult>(
        'sheets/merge-confirm',
        {
          primary: {
            id: section.id,
            name: section.name ?? section.id,
            sportTypes: section.sportTypes,
            visitCount: section.visitCount,
            distanceMeters: section.distanceMeters,
          },
          secondary: {
            id: target.sectionId,
            name: target.name ?? target.sectionId,
            sportTypes: target.sportTypes,
            visitCount: target.visitCount,
            distanceMeters: target.distanceMeters,
          },
        }
      );
      if (confirmation.kind !== 'selected') return;
      const survivor = await merge(confirmation.value.primaryId, confirmation.value.secondaryId);
      if (survivor && survivor !== section.id) router.replace(`/section/${survivor}`);
    } finally {
      running.current = false;
    }
  }, [section, candidates, openSheet, merge]);
}
