import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';
import { useWellness } from '@/hooks/fitness';
import {
  useInsightsStore,
  computeInsightFingerprint,
  diffInsights,
} from '@/providers/InsightsStore';
import {
  computeInsightsFromData,
  fetchInsightsDataFromEngine,
  invalidateInsightsCache,
} from './computeInsightsData';
import type { FfiInsightsDataShape, FfiSummaryCardDataShape } from './computeInsightsData';
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
  preComputedInsightsData?: FfiInsightsDataShape | null,
  /** When true, never make own getInsightsData FFI call — wait for preComputedInsightsData */
  skipOwnFfiCall = false,
  preComputedSummaryCardData?: FfiSummaryCardDataShape | null
): {
  insights: Insight[];
  topInsight: Insight | null;
  hasNewInsights: boolean;
  markAsSeen: () => void;
} {
  const { t } = useTranslation();
  const trigger = useEngineSubscription(['activities', 'sections']);

  // Re-query on screen focus — handles missed notifications during enableFreeze.
  // When the Insights tab is frozen, React state updates from engine notifications
  // are dropped. dirtyRef tracks whether the engine trigger advanced while frozen;
  // useFocusEffect only bumps focusTrigger when there is actually new data.
  const [focusTrigger, setFocusTrigger] = useState(0);
  const dirtyRef = useRef(false);
  const lastSeenTriggerRef = useRef(trigger);
  useEffect(() => {
    if (trigger !== lastSeenTriggerRef.current) {
      dirtyRef.current = true;
      lastSeenTriggerRef.current = trigger;
      // Invalidate cached FFI results so next computation fetches fresh data
      invalidateInsightsCache();
    }
  }, [trigger]);
  useFocusEffect(
    useCallback(() => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setFocusTrigger((ft) => ft + 1);
      }
    }, [])
  );

  const lastSeenFingerprint = useInsightsStore((s) => s.lastSeenFingerprint);
  const setNewInsights = useInsightsStore((s) => s.setNewInsights);
  const markSeenStore = useInsightsStore((s) => s.markSeen);
  const hasNewInsights = useInsightsStore((s) => s.hasNewInsights);

  // Get wellness data for form/TSB (from TanStack Query, not FFI)
  const { data: wellnessData } = useWellness('1m');

  // Stabilise wellness reference — only update when the latest CTL/ATL values
  // actually change.  useWellness returns a new array on every background
  // refetch (refetchOnWindowFocus: true) even when data is identical, which
  // would otherwise trigger a full insights recomputation.
  const prevWellnessRef = useRef(wellnessData);
  const stableWellness = useMemo(() => {
    const prev = prevWellnessRef.current;
    if (prev && wellnessData && prev.length === wellnessData.length) {
      const last = wellnessData[wellnessData.length - 1];
      const prevLast = prev[prev.length - 1];
      if (
        last &&
        prevLast &&
        last.id === prevLast.id &&
        last.ctl === prevLast.ctl &&
        last.atl === prevLast.atl &&
        last.hrv === prevLast.hrv
      ) {
        return prev;
      }
    }
    prevWellnessRef.current = wellnessData;
    return wellnessData;
  }, [wellnessData]);

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
        // fetchInsightsDataFromEngine uses a 30s cache to avoid redundant FFI calls
        const fetched = fetchInsightsDataFromEngine();
        data = fetched?.insightsData ?? null;
        summaryData = fetched?.summaryCardData ?? null;
      }

      if (!data || !isMountedRef.current) return;

      // Delegate to the shared pure function
      const result = computeInsightsFromData(
        data,
        stableWellness ?? null,
        t as (key: string, params?: Record<string, string | number>) => string,
        summaryData
      );

      if (isMountedRef.current) {
        setInsights(result);
      }
    });

    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, focusTrigger, preComputedInsightsData, preComputedSummaryCardData, stableWellness, t]);

  // Stabilise reference -- only update when insight IDs actually change
  const prevInsightsRef = useRef<Insight[]>([]);
  const stableInsights = useMemo(() => {
    const prevIds = prevInsightsRef.current.map((i) => i.id).join(',');
    const newIds = insights.map((i) => i.id).join(',');
    if (prevIds === newIds) return prevInsightsRef.current;
    prevInsightsRef.current = insights;
    return insights;
  }, [insights]);

  // Compute fingerprint + diff once, reuse in both memo and effect
  const lastComputedRef = useRef<{ fingerprint: string; changed: Set<string> }>({
    fingerprint: '',
    changed: new Set(),
  });

  // Annotate isNew based on fingerprint diffing
  const annotatedInsights = useMemo(() => {
    if (stableInsights.length === 0) {
      lastComputedRef.current = { fingerprint: '', changed: new Set() };
      return stableInsights;
    }
    const currentFingerprint = computeInsightFingerprint(stableInsights);
    const changed =
      currentFingerprint === lastSeenFingerprint
        ? new Set<string>()
        : diffInsights(stableInsights, lastSeenFingerprint);
    lastComputedRef.current = { fingerprint: currentFingerprint, changed };
    if (changed.size === 0) return stableInsights;
    return stableInsights.map((i) => (changed.has(i.id) ? { ...i, isNew: true } : i));
  }, [stableInsights, lastSeenFingerprint]);

  // Update hasNewInsights flag — reuse fingerprint/diff from above
  useEffect(() => {
    const { fingerprint, changed } = lastComputedRef.current;
    if (annotatedInsights.length === 0 || fingerprint === lastSeenFingerprint) {
      setNewInsights(new Set());
    } else {
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
