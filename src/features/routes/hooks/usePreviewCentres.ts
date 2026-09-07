/**
 * Ranked riding areas for the preview screen. Centres are read once per mount;
 * the engine ranks them by visit total so the first centre is the user's main
 * riding area, and names each one from the stored activities over its bin.
 */

import { useMemo } from 'react';
import { labelPreviewCentres, type CentreLabel } from '@/features/routes/lib/labelPreviewCentres';
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

  const labels = useMemo(() => labelPreviewCentres(centres), [centres]);

  return { centres, labels };
}
