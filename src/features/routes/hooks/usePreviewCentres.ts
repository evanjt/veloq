/**
 * Ranked riding areas for the preview screen, with locality labels derived
 * from cached activities. Centres are read once per mount; the engine ranks
 * them by visit total so the first centre is the user's main riding area.
 */

import { useMemo } from 'react';
import { useActivities } from '@/features/activity/hooks/useActivities';
import { labelPreviewCentres, type CentreLabel } from '@/features/routes/lib/labelPreviewCentres';
import type {
  PreviewCentre,
  PreviewClient,
} from '../../../../modules/veloqrs/src/delegates/preview';

const DEFAULT_LIMIT = 6;
const LABEL_WINDOW_DAYS = 365;

export interface UsePreviewCentresResult {
  centres: PreviewCentre[];
  /** Aligned with centres; label null means use the numbered fallback. */
  labels: CentreLabel[];
}

export function usePreviewCentres(
  client: PreviewClient | null,
  limit: number = DEFAULT_LIMIT
): UsePreviewCentresResult {
  const { data: activities } = useActivities({ days: LABEL_WINDOW_DAYS });

  const centres = useMemo(() => {
    if (!client) return [];
    try {
      return client.getPreviewCentres(limit);
    } catch {
      return [];
    }
  }, [client, limit]);

  const labels = useMemo(() => {
    const candidates = (activities ?? []).map((a) => ({
      locality: a.locality,
      startLatLng: a.start_latlng,
    }));
    return labelPreviewCentres(centres, candidates);
  }, [centres, activities]);

  return { centres, labels };
}
