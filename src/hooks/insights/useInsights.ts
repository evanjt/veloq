import { useState, useEffect, useRef, useMemo } from 'react';
import { InteractionManager } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';
import { useWellness } from '@/hooks/fitness';
import {
  useInsightsStore,
  computeInsightFingerprint,
  diffInsights,
} from '@/providers/InsightsStore';
import { computeInsightsFromData, fetchInsightsDataFromEngine } from './computeInsightsData';
import type { Insight } from '@/types';

/**
 * Compute ranked insights from FFI data.
 *
 * When `preComputedInsightsData` is provided (from getStartupData), skips the
 * separate getInsightsData FFI call entirely. Falls back to its own deferred
 * FFI call when no pre-computed data is available (e.g., on routes tab).
 *
 * Uses computeInsightsFromData() — the shared pure function that can also run
 * in background tasks without React.
 */
export function useInsights(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preComputedInsightsData?: any,
  /** When true, never make own getInsightsData FFI call — wait for preComputedInsightsData */
  skipOwnFfiCall = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preComputedSummaryCardData?: any
): {
  insights: Insight[];
  topInsight: Insight | null;
  hasNewInsights: boolean;
  markAsSeen: () => void;
} {
  const { t } = useTranslation();
  const trigger = useEngineSubscription(['activities', 'sections']);
  const lastSeenFingerprint = useInsightsStore((s) => s.lastSeenFingerprint);
  const setNewInsights = useInsightsStore((s) => s.setNewInsights);
  const markSeenStore = useInsightsStore((s) => s.markSeen);
  const hasNewInsights = useInsightsStore((s) => s.hasNewInsights);

  // Get wellness data for form/TSB (from TanStack Query, not FFI)
  const { data: wellnessData } = useWellness('1m');

  // Deferred insights computation — starts empty, populates after interactions
  const [insights, setInsights] = useState<Insight[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      if (!isMountedRef.current) return;

      // Use pre-computed data from getStartupData when available
      let data = preComputedInsightsData;
      let summaryData = preComputedSummaryCardData;
      if (!data) {
        if (skipOwnFfiCall) return;
        const fetched = fetchInsightsDataFromEngine();
        data = fetched?.insightsData ?? null;
        summaryData = fetched?.summaryCardData ?? null;
      }

      if (!data || !isMountedRef.current) return;

      // Delegate to the shared pure function
      const result = computeInsightsFromData(
        data,
        wellnessData ?? null,
        t as (key: string, params?: Record<string, string | number>) => string,
        summaryData
      );

      if (isMountedRef.current) {
        setInsights(result);
      }
    });

    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, preComputedInsightsData, preComputedSummaryCardData, wellnessData, t]);

  // Stabilise reference -- only update when insight IDs actually change
  const prevInsightsRef = useRef<Insight[]>([]);
  const stableInsights = useMemo(() => {
    const prevIds = prevInsightsRef.current.map((i) => i.id).join(',');
    const newIds = insights.map((i) => i.id).join(',');
    if (prevIds === newIds) return prevInsightsRef.current;
    prevInsightsRef.current = insights;
    return insights;
  }, [insights]);

  // Annotate isNew based on fingerprint diffing
  const annotatedInsights = useMemo(() => {
    if (stableInsights.length === 0) return stableInsights;
    const currentFingerprint = computeInsightFingerprint(stableInsights);
    if (currentFingerprint === lastSeenFingerprint) return stableInsights;
    const changed = diffInsights(stableInsights, lastSeenFingerprint);
    if (changed.size === 0) return stableInsights;
    return stableInsights.map((i) => (changed.has(i.id) ? { ...i, isNew: true } : i));
  }, [stableInsights, lastSeenFingerprint]);

  // Update hasNewInsights flag based on fingerprint diff
  useEffect(() => {
    if (annotatedInsights.length === 0) {
      setNewInsights(new Set());
      return;
    }
    const currentFingerprint = computeInsightFingerprint(annotatedInsights);
    if (currentFingerprint === lastSeenFingerprint) {
      setNewInsights(new Set());
    } else {
      const changed = diffInsights(annotatedInsights, lastSeenFingerprint);
      setNewInsights(changed);
    }
  }, [annotatedInsights, lastSeenFingerprint, setNewInsights]);

  // markAsSeen stores the current fingerprint
  const markAsSeen = useMemo(
    () => () => markSeenStore(annotatedInsights),
    [markSeenStore, annotatedInsights]
  );

  return {
    insights: annotatedInsights,
    topInsight: annotatedInsights[0] ?? null,
    hasNewInsights,
    markAsSeen,
  };
}
