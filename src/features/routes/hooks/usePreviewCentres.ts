/**
 * Ranked riding areas for the preview screen. Centres are read once per mount;
 * the engine ranks them by visit total so the first centre is the user's main
 * riding area, and names each one from the stored activities over its bin.
 */

import { useMemo } from 'react';
import { labelPreviewCentres, type CentreLabel } from '@/features/routes/lib/labelPreviewCentres';
import { attemptEngineRead } from '@/shared/native/engineError';
import { useReadRetry } from '@/shared/native/useEngineSubscription';
import type { PreviewCentre, PreviewClient } from 'veloqrs';

const DEFAULT_LIMIT = 6;

export interface UsePreviewCentresResult {
  centres: PreviewCentre[];
  /** Aligned with centres; label null means use the numbered fallback. */
  labels: CentreLabel[];
  /** What the ranking read threw; the empty list then is a failure, not a quiet map. */
  error: unknown;
  /** Ranks the centres again after a failure. */
  retry: () => void;
}

export function usePreviewCentres(
  client: PreviewClient | null,
  limit: number = DEFAULT_LIMIT
): UsePreviewCentresResult {
  const [attempt, retry] = useReadRetry();
  const ranking = useMemo((): { centres: PreviewCentre[]; error: unknown } => {
    // A retry is a reason to read again that the client cannot see.
    void attempt;
    if (!client) return { centres: [], error: undefined };
    const read = attemptEngineRead(() => client.getPreviewCentres(limit));
    return read.ok ? { centres: read.value, error: undefined } : { centres: [], error: read.error };
  }, [client, limit, attempt]);

  const labels = useMemo(() => labelPreviewCentres(ranking.centres), [ranking.centres]);

  return { centres: ranking.centres, labels, error: ranking.error, retry };
}
