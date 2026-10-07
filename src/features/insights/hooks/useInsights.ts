import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { runWhenIdle } from '@/shared/async/runWhenIdle';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from 'expo-router';

import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { useStableBy } from '@/shared/app/useStableBy';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { useWellness } from '@/features/wellness';

import { useInsightsStore, computeInsightFingerprint, diffInsights } from '../store';
import { computeInsightsFromData, fetchInsightsDataFromEngine } from '../lib/computeInsightsData';
import type { Insight } from '../types';

/** What `useWellness` hands back, without reaching into another feature for the row type. */
type WellnessArray = ReturnType<typeof useWellness>['data'];
/**
 * How long a recompute waits for further engine announcements before it runs.
 * Long enough to swallow a launch's burst, short enough that a real change
 * reaches the screen while the athlete is still looking at it.
 */
const RECOMPUTE_SETTLE_MS = 400;

/**
 * Compute ranked insights from FFI data.
 *
 * Makes its own deferred `getInsightsData` call. It used to take pre-computed
 * data and a flag to suppress that call, for a caller that handed it
 * `getStartupData`'s bundle; no caller has passed either since that path went,
 * and the one caller left is the Insights tab.
 *
 * Uses computeInsightsFromData() - the shared pure function that can also run
 * in background tasks without React.
 */
/**
 * What makes one wellness array the same data as the last.
 *
 * `useWellness` hands back a new array on every background refetch, which
 * `refetchOnWindowFocus` makes often, and a fresh reference would recompute
 * every insight. Only the length and the latest day's four numbers decide
 * anything downstream, so they are the key. `undefined` is not an empty
 * library: one is "nothing loaded yet" and the other "nothing recorded".
 */
function wellnessKey(data: WellnessArray): string {
  if (data === undefined) return 'none';
  const last = data[data.length - 1];
  if (!last) return `${data.length}|empty`;
  return `${data.length}|${last.id}|${last.ctl}|${last.atl}|${last.hrv}`;
}

export function useInsights(): {
  insights: Insight[];
  /** The pipeline threw, so an empty list is not an empty library */
  failed: boolean;
  /** Reads the insights again after a failure */
  retry: () => void;
  /** The newest form reading out of the same bundle, null without wellness */
  form: { ctl: number; atl: number } | null;
  hasNewInsights: boolean;
  markAsSeen: () => void;
  /**
   * The newest stored wellness date, set by the engine only when the HRV
   * trend was withheld because the window went stale.
   */
  hrvWithheldSince: string | null;
} {
  const { t } = useTranslation();
  const trigger = useEngineSubscription(['activities', 'sections']);

  // Re-query on screen focus - handles missed notifications during enableFreeze.
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

  // Only update when the latest CTL/ATL values actually change: the reason is
  // on `wellnessKey`.
  const stableWellness = useStableBy(wellnessData, wellnessKey(wellnessData));
  const isMetric = useMetricSystem();

  // Deferred insights computation - starts empty, populates after interactions
  const [insights, setInsights] = useState<Insight[]>([]);
  const [failed, setFailed] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const retry = useCallback(() => setRetryTrigger((n) => n + 1), []);
  const [form, setForm] = useState<{ ctl: number; atl: number } | null>(null);
  const [hrvWithheldSince, setHrvWithheldSince] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // The first read is the visit's own and runs as soon as the thread is idle.
  // Later ones wait for the announcements to stop: the engine raises
  // `activities` and `sections` several times while a launch settles, and each
  // read is about 70 ms under the engine lock on the thread drawing the tab.
  const hasComputedRef = useRef(false);

  useEffect(() => {
    let cancelRun: (() => void) | null = null;
    const compute = () => {
      cancelRun = runWhenIdle(() => {
        if (!isMountedRef.current) return;

        let fetched: ReturnType<typeof fetchInsightsDataFromEngine>;
        try {
          fetched = fetchInsightsDataFromEngine();
        } catch (e) {
          console.error('[insights] engine read failed', e);
          if (isMountedRef.current) setFailed(true);
          return;
        }
        const data = fetched?.insightsData ?? null;
        const summaryData = fetched?.summaryCardData ?? null;

        if (!data || !isMountedRef.current) return;

        // Delegate to the shared pure function
        const result = computeInsightsFromData(
          data,
          t as (key: string, params?: Record<string, string | number>) => string,
          summaryData,
          isMetric
        );

        if (isMountedRef.current) {
          hasComputedRef.current = true;
          setInsights(result.insights);
          setFailed(result.failed);
          setForm(data.form ? { ctl: data.form.ctl, atl: data.form.atl } : null);
          setHrvWithheldSince(data.hrvWithheldSince ?? null);
        }
      });
    };

    if (!hasComputedRef.current) {
      compute();
      return () => cancelRun?.();
    }
    const settle = setTimeout(compute, RECOMPUTE_SETTLE_MS);
    return () => {
      clearTimeout(settle);
      cancelRun?.();
    };
  }, [trigger, focusTrigger, retryTrigger, stableWellness, t, isMetric]);

  // Stabilise reference -- only update when insight IDs actually change
  const stableInsights = useStableBy(insights, insights.map((i) => i.id).join(','));

  // The fingerprint and the diff are computed once and both the annotated list
  // and the flag below read them. They were written to a ref inside this memo,
  // which a discarded render also writes, so the effect could read a fingerprint
  // the committed tree never had.
  const annotated = useMemo(() => {
    if (stableInsights.length === 0) {
      return { insights: stableInsights, fingerprint: '', changed: new Set<string>() };
    }
    const fingerprint = computeInsightFingerprint(stableInsights);
    const changed =
      fingerprint === lastSeenFingerprint
        ? new Set<string>()
        : diffInsights(stableInsights, lastSeenFingerprint);
    const insights =
      changed.size === 0
        ? stableInsights
        : stableInsights.map((i) => (changed.has(i.id) ? { ...i, isNew: true } : i));
    return { insights, fingerprint, changed };
  }, [stableInsights, lastSeenFingerprint]);

  const annotatedInsights = annotated.insights;

  // Update hasNewInsights flag - reuse fingerprint/diff from above
  useEffect(() => {
    const { fingerprint, changed } = annotated;
    if (annotated.insights.length === 0 || fingerprint === lastSeenFingerprint) {
      setNewInsights(false);
    } else {
      setNewInsights(changed.size > 0);
    }
  }, [annotated, lastSeenFingerprint, setNewInsights]);

  // markAsSeen stores the current fingerprint
  const markAsSeen = useMemo(
    () => () => markSeenStore(annotatedInsights),
    [markSeenStore, annotatedInsights]
  );

  return {
    insights: annotatedInsights,
    failed,
    retry,
    form,
    hasNewInsights,
    markAsSeen,
    hrvWithheldSince,
  };
}
