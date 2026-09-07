/**
 * Ranked riding areas for the preview screen, with locality labels derived
 * from stored activities. Centres are read once per mount; the engine ranks
 * them by visit total so the first centre is the user's main riding area.
 * The labels are joined against the whole stored history rather than a synced
 * window, so an area last ridden years ago still gets its name (B422).
 */

import { useMemo } from 'react';
import { labelPreviewCentres, type CentreLabel } from '@/features/routes/lib/labelPreviewCentres';
import { readStoredCentreCandidates } from '@/features/routes/lib/storedCentreCandidates';
import type {
  PreviewCentre,
  PreviewClient,
} from '../../../../modules/veloqrs/src/delegates/preview';

const DEFAULT_LIMIT = 6;

export interface UsePreviewCentresResult {
  centres: PreviewCentre[];
  /** Aligned with centres; label null means use the numbered fallback. */
  labels: CentreLabel[];
}

export function usePreviewCentres(
  client: PreviewClient | null,
  limit: number = DEFAULT_LIMIT
): UsePreviewCentresResult {
  const centres = useMemo(() => {
    if (!client) return [];
    try {
      return client.getPreviewCentres(limit);
    } catch {
      return [];
    }
  }, [client, limit]);

  const labels = useMemo(() => {
    const joined = labelPreviewCentres(centres, readStoredCentreCandidates());
    if (__DEV__) {
      for (const label of joined) {
        if (label.label) continue;
        const { seen, withLocality, withPosition, nearestMetres } = label.join;
        console.warn(
          `[PreviewCentres] ${label.binKey} fell back: seen ${seen}, locality ${withLocality}, ` +
            `position ${withPosition}, nearest ${nearestMetres === null ? 'none' : Math.round(nearestMetres)} m`
        );
      }
    }
    return joined;
  }, [centres]);

  return { centres, labels };
}
