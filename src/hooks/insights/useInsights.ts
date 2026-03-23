import { useState, useEffect, useRef, useMemo } from 'react';
import { InteractionManager } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';
import { useWellness } from '@/hooks/fitness';
import {
  useInsightsStore,
  computeInsightFingerprint,
  diffInsights,
} from '@/providers/InsightsStore';
import { generateInsights } from './generateInsights';
import type { Insight } from '@/types';

/**
 * Compute ranked insights from a single batch FFI call (getInsightsData).
 * All heavy computation (period stats, section summaries, PR detection)
 * happens in Rust within one engine lock. Deferred via InteractionManager
 * so it never blocks feed rendering.
 *
 * Performance: ~30-50ms deferred (was ~860ms synchronous with 13-16 FFI calls).
 */
export function useInsights(): {
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
  const latestWellness = wellnessData
    ? [...wellnessData].sort((a, b) => b.id.localeCompare(a.id))[0]
    : null;
  const ctl = latestWellness?.ctl ?? latestWellness?.ctlLoad ?? 0;
  const atl = latestWellness?.atl ?? latestWellness?.atlLoad ?? 0;
  const tsb = ctl - atl;

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
      const engine = getRouteEngine();
      if (!engine || !isMountedRef.current) return;

      try {
        // Compute timestamps for period ranges
        const now = new Date();
        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay();
        startOfWeek.setDate(startOfWeek.getDate() - day + (day === 0 ? -6 : 1)); // Monday start
        startOfWeek.setHours(0, 0, 0, 0);

        const startOfLastWeek = new Date(startOfWeek);
        startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

        const fourWeeksAgo = new Date(startOfWeek);
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        const toTs = (d: Date) => Math.floor(d.getTime() / 1000);

        // Single batch FFI call — all computation in Rust, one engine lock
        const data = engine.getInsightsData(
          toTs(startOfWeek),
          toTs(now),
          toTs(startOfLastWeek),
          toTs(startOfWeek),
          toTs(fourWeeksAgo),
          toTs(todayStart)
        );

        if (!data || !isMountedRef.current) return;

        // Convert FFI bigint fields to number for generateInsights
        const toPeriod = (p: {
          count: number;
          totalDuration: bigint | number;
          totalDistance: number;
          totalTss: number;
        }) => ({
          count: p.count,
          totalDuration: Number(p.totalDuration),
          totalDistance: p.totalDistance,
          totalTss: p.totalTss,
        });

        // Average chronic period per week (raw total / 4 weeks)
        const chronicPeriod = {
          count: Math.round(data.chronicPeriod.count / 4),
          totalDuration: Number(data.chronicPeriod.totalDuration) / 4,
          totalDistance: data.chronicPeriod.totalDistance / 4,
          totalTss: data.chronicPeriod.totalTss / 4,
        };

        // Rest day detection
        const isRestDay = data.todayPeriod.count === 0;

        // Type the patterns array for downstream use (generated types not yet available)
        const allPatterns = (data.allPatterns ?? []) as Array<{
          primaryDay: number;
          confidence: number;
          sportType: string;
          avgDurationSecs: number;
          activityCount: number;
          commonSections?: Array<{
            sectionId: string;
            sectionName: string;
            trend: number | null;
            medianRecentSecs: number;
            bestTimeSecs: number;
            traversalCount: number;
          }>;
        }>;

        // Extract section trends from patterns (deduplicate by highest traversalCount)
        const sectionTrendMap = new Map<
          string,
          {
            sectionId: string;
            sectionName: string;
            trend: number;
            medianRecentSecs: number;
            bestTimeSecs: number;
            traversalCount: number;
          }
        >();

        for (const pattern of allPatterns) {
          if (!pattern.commonSections) continue;
          for (const section of pattern.commonSections) {
            if (section.trend == null || !section.sectionId) continue;
            const existing = sectionTrendMap.get(section.sectionId);
            if (!existing || section.traversalCount > existing.traversalCount) {
              sectionTrendMap.set(section.sectionId, {
                sectionId: section.sectionId,
                sectionName: section.sectionName || 'Section',
                trend: section.trend,
                medianRecentSecs: section.medianRecentSecs,
                bestTimeSecs: section.bestTimeSecs,
                traversalCount: section.traversalCount,
              });
            }
          }
        }

        const sectionTrends = Array.from(sectionTrendMap.values()).sort(
          (a, b) => b.traversalCount - a.traversalCount
        );

        // 7-day wellness window (from TanStack Query, not FFI)
        const wellnessWindow = (wellnessData ?? [])
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(-7)
          .map((w) => ({
            date: w.id,
            hrv: w.hrv ?? undefined,
            restingHR: w.restingHR ?? undefined,
            sleepSecs: w.sleepSecs ?? undefined,
            ctl: w.ctl ?? w.ctlLoad ?? undefined,
            atl: w.atl ?? w.atlLoad ?? undefined,
          }));

        // Tomorrow's pattern prediction
        const tomorrowDayJs = (now.getDay() + 1) % 7; // 0=Sun JS convention
        const tomorrowDayMon = tomorrowDayJs === 0 ? 6 : tomorrowDayJs - 1; // Convert to 0=Mon
        const tomorrowPattern =
          allPatterns.find((p) => p.primaryDay === tomorrowDayMon && p.confidence >= 0.6) ?? null;

        // Recent PRs from batch result (already computed in Rust)
        const recentPRs = (
          (data.recentPrs ?? []) as Array<{
            sectionId: string;
            sectionName: string;
            bestTime: number;
            daysAgo: number;
          }>
        ).map((pr) => ({
          sectionId: pr.sectionId,
          sectionName: pr.sectionName,
          bestTime: pr.bestTime,
          daysAgo: pr.daysAgo,
        }));

        const result = generateInsights(
          {
            currentPeriod: toPeriod(data.currentWeek),
            previousPeriod: toPeriod(data.previousWeek),
            ftpTrend: data.ftpTrend ?? null,
            paceTrend: data.runPaceTrend ?? null,
            recentPRs,
            todayPattern: data.todayPattern ?? null,
            sectionTrends,
            formTsb: latestWellness ? tsb : null,
            formCtl: ctl > 0 ? ctl : null,
            formAtl: atl > 0 ? atl : null,
            peakCtl: null,
            currentCtl: ctl > 0 ? ctl : null,
            wellnessWindow,
            chronicPeriod,
            isRestDay,
            allSectionTrends: sectionTrends,
            tomorrowPattern: tomorrowPattern
              ? {
                  sportType: tomorrowPattern.sportType,
                  primaryDay: tomorrowPattern.primaryDay,
                  avgDurationSecs: tomorrowPattern.avgDurationSecs,
                  confidence: tomorrowPattern.confidence,
                  activityCount: tomorrowPattern.activityCount,
                }
              : null,
          },
          t as (key: string, params?: Record<string, string | number>) => string
        );

        if (isMountedRef.current) {
          setInsights(result);
        }
      } catch {
        if (isMountedRef.current) {
          setInsights([]);
        }
      }
    });

    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, wellnessData, tsb, ctl, atl, latestWellness, t]);

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
