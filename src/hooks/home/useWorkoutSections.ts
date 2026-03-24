import { useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';
import { generateSectionName } from '@/lib/utils/sectionNaming';

export interface WorkoutSection {
  id: string;
  name: string;
  prTimeSecs: number | null;
  /** Second-best time (previous PR before current best) */
  previousBestTimeSecs: number | null;
  lastTimeSecs: number | null;
  daysSinceLast: number | null;
  trend: 'improving' | 'stable' | 'declining' | null;
}

/**
 * Find sections matching a sport type with PR + trend data.
 * Returns top sections by visit count, enriched with performance metrics.
 *
 * Trend calculation: compare median of last 5 efforts to median of previous 5.
 * Requires >=5 traversals to compute a trend, >=3% change to show an arrow.
 * (JMIR mHealth 2022 — only surface insights when genuinely meaningful)
 */
export function useWorkoutSections(sportType: string | undefined): {
  sections: WorkoutSection[];
} {
  const trigger = useEngineSubscription(['sections']);

  const sections = useMemo(() => {
    if (!sportType) return [];

    const engine = getRouteEngine();
    if (!engine) return [];

    // Get section summaries for this sport type, sorted by visit count
    const summaries = engine.getSectionSummaries(sportType).summaries;
    const topSections = summaries
      .filter((s) => s.visitCount >= 5)
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, 5);

    if (topSections.length === 0) return [];

    const now = Date.now();
    const result: WorkoutSection[] = [];

    for (const summary of topSections) {
      const perf = engine.getSectionPerformances(summary.id);
      if (!perf || perf.records.length === 0) continue;

      const bestRecord = perf.bestRecord ?? perf.bestForwardRecord;
      const prTimeSecs = bestRecord?.bestTime ?? null;

      // Find second-best time (previous PR) by scanning all records
      let previousBestTimeSecs: number | null = null;
      if (bestRecord && perf.records.length >= 2) {
        for (const r of perf.records) {
          if (r.activityId === bestRecord.activityId) continue;
          if (previousBestTimeSecs === null || r.bestTime < previousBestTimeSecs) {
            previousBestTimeSecs = r.bestTime;
          }
        }
      }

      // Sort records by date (newest first) — activityDate is bigint from FFI
      const sorted = [...perf.records].sort((a, b) =>
        a.activityDate > b.activityDate ? -1 : a.activityDate < b.activityDate ? 1 : 0
      );
      const lastTimeSecs = sorted[0]?.bestTime ?? null;
      const daysSinceLast = sorted[0]
        ? Math.floor((now - Number(sorted[0].activityDate) * 1000) / 86400000)
        : null;

      // Compute trend: median of last 5 vs median of previous 5
      let trend: WorkoutSection['trend'] = null;
      if (sorted.length >= 5) {
        const recentTimes = sorted.slice(0, 5).map((r) => r.bestTime);
        const previousTimes = sorted.slice(5, 10).map((r) => r.bestTime);
        if (previousTimes.length >= 5) {
          const recentMedian = median(recentTimes);
          const previousMedian = median(previousTimes);
          const change = (previousMedian - recentMedian) / previousMedian;
          // Lower time = better, so positive change = improving
          if (change >= 0.03) trend = 'improving';
          else if (change <= -0.03) trend = 'declining';
          else trend = 'stable';
        }
      }

      result.push({
        id: summary.id,
        name: summary.name || generateSectionName(summary),
        prTimeSecs,
        previousBestTimeSecs,
        lastTimeSecs,
        daysSinceLast,
        trend,
      });
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportType, trigger]);

  return { sections };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
