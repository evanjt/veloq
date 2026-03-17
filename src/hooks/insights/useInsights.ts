import { useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';
import { useActivityPatterns } from '@/hooks/home/useActivityPatterns';
import { useWellness } from '@/hooks/fitness';
import {
  useInsightsStore,
  computeInsightFingerprint,
  diffInsights,
} from '@/providers/InsightsStore';
import { generateInsights } from './generateInsights';
import type { Insight } from '@/types';

/**
 * Compute ranked insights from existing FFI data.
 * No new Rust FFI functions needed -- uses:
 *   getPeriodStats (x3), getFtpTrend, getPaceTrend,
 *   getSectionSummariesForSport, getSectionPerformances
 *
 * Performance budget: <100ms total computation.
 */
export function useInsights(): {
  insights: Insight[];
  topInsight: Insight | null;
  hasNewInsights: boolean;
  markAsSeen: () => void;
} {
  const { t } = useTranslation();
  const trigger = useEngineSubscription(['activities', 'sections']);
  const { todayPattern, allPatterns } = useActivityPatterns();
  const lastSeenFingerprint = useInsightsStore((s) => s.lastSeenFingerprint);
  const setNewInsights = useInsightsStore((s) => s.setNewInsights);
  const markSeenStore = useInsightsStore((s) => s.markSeen);
  const hasNewInsights = useInsightsStore((s) => s.hasNewInsights);
  const changedInsightIds = useInsightsStore((s) => s.changedInsightIds);

  // Get wellness data for form/TSB
  const { data: wellnessData } = useWellness('1m');
  const latestWellness = wellnessData
    ? [...wellnessData].sort((a, b) => b.id.localeCompare(a.id))[0]
    : null;
  const ctl = latestWellness?.ctl ?? latestWellness?.ctlLoad ?? 0;
  const atl = latestWellness?.atl ?? latestWellness?.atlLoad ?? 0;
  const tsb = ctl - atl;

  const insights = useMemo(() => {
    const engine = getRouteEngine();
    if (!engine) return [];

    try {
      // Get period stats: this week vs last week (timestamps in seconds)
      // Monday-based weeks to match SummaryCard + intervals.icu convention
      const now = new Date();
      const startOfWeek = new Date(now);
      const day = startOfWeek.getDay();
      startOfWeek.setDate(startOfWeek.getDate() - day + (day === 0 ? -6 : 1)); // Monday start
      startOfWeek.setHours(0, 0, 0, 0);

      const startOfLastWeek = new Date(startOfWeek);
      startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

      const toTs = (d: Date) => Math.floor(d.getTime() / 1000);

      const currentPeriod = engine.getPeriodStats(toTs(startOfWeek), toTs(now));
      const previousPeriod = engine.getPeriodStats(toTs(startOfLastWeek), toTs(startOfWeek));

      // 4-week chronic period for weekly load change
      const fourWeeksAgo = new Date(startOfWeek);
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
      const chronicPeriodRaw = engine.getPeriodStats(toTs(fourWeeksAgo), toTs(startOfWeek));
      // Average per week: divide totals by 4
      const chronicPeriod = chronicPeriodRaw
        ? {
            count: Math.round(chronicPeriodRaw.count / 4),
            totalDuration: Number(chronicPeriodRaw.totalDuration) / 4,
            totalDistance: chronicPeriodRaw.totalDistance / 4,
            totalTss: chronicPeriodRaw.totalTss / 4,
          }
        : null;

      // Rest day detection: check if today has any activities
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayPeriod = engine.getPeriodStats(toTs(todayStart), toTs(now));
      const isRestDay = !todayPeriod || todayPeriod.count === 0;

      // Get FTP and pace trends
      const ftpTrend = engine.getFtpTrend?.() ?? null;
      const paceTrend = engine.getPaceTrend?.('Run') ?? null;

      // Find recent PRs: check top sections for recent PR records
      const recentPRs: Array<{
        sectionId: string;
        sectionName: string;
        bestTime: number;
        daysAgo: number;
      }> = [];

      try {
        const summaries = engine.getSectionSummaries('Ride').summaries ?? [];
        const runSummaries = engine.getSectionSummaries('Run').summaries ?? [];
        // Take top sections by visit count (most likely to have PRs)
        const allSummaries = [...summaries, ...runSummaries]
          .filter((s) => s.visitCount >= 3)
          .sort((a, b) => b.visitCount - a.visitCount)
          .slice(0, 10); // Limit to top 10 to bound FFI calls

        const sevenDaysAgo = Math.floor((Date.now() - 7 * 86400000) / 1000);

        for (const s of allSummaries) {
          if (recentPRs.length >= 3) break;

          const perf = engine.getSectionPerformances(s.id);
          if (!perf || !perf.records || perf.records.length < 2) continue;

          const bestRecord = perf.bestRecord ?? perf.bestForwardRecord;
          if (!bestRecord) continue;

          // Check if the best time was set in the last 7 days
          const bestDate = Number(bestRecord.activityDate ?? 0);
          if (bestDate >= sevenDaysAgo) {
            const daysAgo = Math.floor((Date.now() / 1000 - bestDate) / 86400);
            recentPRs.push({
              sectionId: s.id,
              sectionName: s.name || 'Section',
              bestTime: bestRecord.bestTime,
              daysAgo: Math.max(0, daysAgo),
            });
          }
        }
      } catch {
        // Section PR detection is optional -- don't fail the whole hook
      }

      // Extract section trends from all patterns (deduplicate by highest traversalCount)
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

      for (const pattern of allPatterns ?? []) {
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

      // 7-day wellness window
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
        (allPatterns ?? []).find((p) => p.primaryDay === tomorrowDayMon && p.confidence >= 0.6) ??
        null;

      // Convert FFI bigint fields to number for generateInsights
      const toPeriod = (p: typeof currentPeriod) =>
        p
          ? {
              count: p.count,
              totalDuration: Number(p.totalDuration),
              totalDistance: p.totalDistance,
              totalTss: p.totalTss,
            }
          : null;

      return generateInsights(
        {
          currentPeriod: toPeriod(currentPeriod),
          previousPeriod: toPeriod(previousPeriod),
          ftpTrend: ftpTrend ?? null,
          paceTrend: paceTrend ?? null,
          recentPRs,
          todayPattern: todayPattern ?? null,
          sectionTrends,
          formTsb: latestWellness ? tsb : null,
          formCtl: ctl > 0 ? ctl : null,
          formAtl: atl > 0 ? atl : null,
          peakCtl: null, // Removed: no validated concept
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
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, todayPattern, allPatterns, wellnessData, tsb, ctl, atl, latestWellness, t]);

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
