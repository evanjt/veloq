import { useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';
import { useActivityPatterns } from '@/hooks/home/useActivityPatterns';
import { useWellness } from '@/hooks/fitness';
import { useInsightsStore } from '@/providers/InsightsStore';
import { generateInsights } from './generateInsights';
import type { Insight } from '@/types';

/**
 * Compute ranked insights from existing FFI data.
 * No new Rust FFI functions needed — uses:
 *   getPeriodStats (x2), getFtpTrend, getPaceTrend,
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
  const lastSeenTimestamp = useInsightsStore((s) => s.lastSeenTimestamp);
  const setHasNewInsights = useInsightsStore((s) => s.setHasNewInsights);
  const markSeen = useInsightsStore((s) => s.markSeen);
  const hasNewInsights = useInsightsStore((s) => s.hasNewInsights);

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
        const summaries = engine.getSectionSummariesForSport?.('Ride') ?? [];
        const runSummaries = engine.getSectionSummariesForSport?.('Run') ?? [];
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
        // Section PR detection is optional - don't fail the whole hook
      }

      // Find peak CTL from wellness data
      let peakCtl: number | null = null;
      if (wellnessData) {
        for (const w of wellnessData) {
          const c = w.ctl ?? w.ctlLoad ?? 0;
          if (c > (peakCtl ?? 0)) peakCtl = c;
        }
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
          peakCtl,
          currentCtl: ctl > 0 ? ctl : null,
        },
        t as (key: string, params?: Record<string, string | number>) => string
      );
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, todayPattern, allPatterns, wellnessData, tsb, ctl, atl, latestWellness, t]);

  // Stabilise reference — only update when insight IDs actually change
  const prevInsightsRef = useRef<Insight[]>([]);
  const stableInsights = useMemo(() => {
    const prevIds = prevInsightsRef.current.map((i) => i.id).join(',');
    const newIds = insights.map((i) => i.id).join(',');
    if (prevIds === newIds) return prevInsightsRef.current;
    prevInsightsRef.current = insights;
    return insights;
  }, [insights]);

  // Update hasNewInsights flag based on insight timestamps vs lastSeen
  useEffect(() => {
    const hasNew =
      stableInsights.length > 0 && stableInsights.some((i) => i.timestamp > lastSeenTimestamp);
    setHasNewInsights(hasNew);
  }, [stableInsights, lastSeenTimestamp, setHasNewInsights]);

  return {
    insights: stableInsights,
    topInsight: stableInsights[0] ?? null,
    hasNewInsights,
    markAsSeen: markSeen,
  };
}
