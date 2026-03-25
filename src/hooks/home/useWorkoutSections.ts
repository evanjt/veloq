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
  /** Days since PR was set (based on the activity date of the best record) */
  prDaysAgo: number | null;
  trend: 'improving' | 'stable' | 'declining' | null;
}

/**
 * Find sections matching a sport type with PR + trend data.
 * Uses ML-ranked sections (composite relevance score combining recency,
 * improvement, anomaly detection, and engagement signals) when available,
 * falling back to visit-count sort if the engine returns empty results.
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

    // Try ML-ranked sections first (composite relevance score)
    const ranked = engine.getRankedSections(sportType, 5);

    if (ranked.length > 0) {
      return enrichRankedSections(engine, ranked);
    }

    // Fall back to visit-count sort when getRankedSections returns empty
    return enrichVisitCountSections(engine, sportType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportType, trigger]);

  return { sections };
}

/**
 * Enrich ML-ranked sections with performance metrics.
 * The ranked results already include trend and timing data from the Rust engine,
 * but we fetch full performance records to get PR details and second-best times.
 */
function enrichRankedSections(
  engine: NonNullable<ReturnType<typeof getRouteEngine>>,
  ranked: ReturnType<NonNullable<ReturnType<typeof getRouteEngine>>['getRankedSections']>
): WorkoutSection[] {
  const now = Date.now();
  const result: WorkoutSection[] = [];

  for (const rs of ranked) {
    const perf = engine.getSectionPerformances(rs.sectionId);
    if (!perf || perf.records.length === 0) {
      // Use data from ranked result even without full performance records
      result.push({
        id: rs.sectionId,
        name: rs.sectionName || rs.sectionId,
        prTimeSecs: rs.bestTimeSecs > 0 ? rs.bestTimeSecs : null,
        previousBestTimeSecs: null,
        lastTimeSecs: rs.medianRecentSecs > 0 ? rs.medianRecentSecs : null,
        daysSinceLast: rs.daysSinceLast > 0 ? rs.daysSinceLast : null,
        prDaysAgo: null,
        trend: trendFromInt(rs.trend),
      });
      continue;
    }

    const bestRecord = perf.bestRecord ?? perf.bestForwardRecord;
    const prTimeSecs = bestRecord?.bestTime ?? null;

    const prDaysAgo = bestRecord?.activityDate
      ? Math.floor((now - Number(bestRecord.activityDate) * 1000) / 86400000)
      : null;

    let previousBestTimeSecs: number | null = null;
    if (bestRecord && perf.records.length >= 2) {
      for (const r of perf.records) {
        if (r.activityId === bestRecord.activityId) continue;
        if (previousBestTimeSecs === null || r.bestTime < previousBestTimeSecs) {
          previousBestTimeSecs = r.bestTime;
        }
      }
    }

    const sorted = [...perf.records].sort((a, b) =>
      a.activityDate > b.activityDate ? -1 : a.activityDate < b.activityDate ? 1 : 0
    );
    const lastTimeSecs = sorted[0]?.bestTime ?? null;
    const daysSinceLast = sorted[0]
      ? Math.floor((now - Number(sorted[0].activityDate) * 1000) / 86400000)
      : null;

    result.push({
      id: rs.sectionId,
      name: rs.sectionName || rs.sectionId,
      prTimeSecs,
      previousBestTimeSecs,
      lastTimeSecs,
      daysSinceLast,
      prDaysAgo,
      trend: trendFromInt(rs.trend),
    });
  }

  return result;
}

/**
 * Fallback: enrich sections sorted by visit count (original logic).
 * Used when getRankedSections returns empty (engine not ready or no data).
 */
function enrichVisitCountSections(
  engine: NonNullable<ReturnType<typeof getRouteEngine>>,
  sportType: string
): WorkoutSection[] {
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

    const prDaysAgo = bestRecord?.activityDate
      ? Math.floor((now - Number(bestRecord.activityDate) * 1000) / 86400000)
      : null;

    let previousBestTimeSecs: number | null = null;
    if (bestRecord && perf.records.length >= 2) {
      for (const r of perf.records) {
        if (r.activityId === bestRecord.activityId) continue;
        if (previousBestTimeSecs === null || r.bestTime < previousBestTimeSecs) {
          previousBestTimeSecs = r.bestTime;
        }
      }
    }

    const sorted = [...perf.records].sort((a, b) =>
      a.activityDate > b.activityDate ? -1 : a.activityDate < b.activityDate ? 1 : 0
    );
    const lastTimeSecs = sorted[0]?.bestTime ?? null;
    const daysSinceLast = sorted[0]
      ? Math.floor((now - Number(sorted[0].activityDate) * 1000) / 86400000)
      : null;

    let trend: WorkoutSection['trend'] = null;
    if (sorted.length >= 5) {
      const recentTimes = sorted.slice(0, 5).map((r) => r.bestTime);
      const previousTimes = sorted.slice(5, 10).map((r) => r.bestTime);
      if (previousTimes.length >= 5) {
        const recentMedian = median(recentTimes);
        const previousMedian = median(previousTimes);
        const change = previousMedian > 0 ? (previousMedian - recentMedian) / previousMedian : 0;
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
      prDaysAgo,
      trend,
    });
  }

  return result;
}

/** Convert integer trend from FFI (-1/0/1) to typed string */
function trendFromInt(trend: number): WorkoutSection['trend'] {
  if (trend > 0) return 'improving';
  if (trend < 0) return 'declining';
  return 'stable';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
