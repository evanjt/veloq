import { getRouteEngine } from '@/lib/native/routeEngine';
import { useDisabledSections } from '@/providers';
import { generateInsights } from './generateInsights';
import type { Insight } from '@/types';

type TFunc = (key: string, params?: Record<string, string | number>) => string;

/**
 * Wellness data needed for insight generation.
 * This is the subset of intervals.icu wellness that generateInsights uses.
 * Can come from TanStack Query (React) or direct API fetch (background task).
 */
export interface WellnessInput {
  id: string; // date string YYYY-MM-DD
  ctl?: number | null;
  ctlLoad?: number | null;
  atl?: number | null;
  atlLoad?: number | null;
  hrv?: number | null;
  restingHR?: number | null;
  sleepSecs?: number | null;
}

/**
 * Compute insights from engine data + wellness data.
 *
 * Pure function — no React hooks, no context, no side effects.
 * Can be called from:
 *   - useInsights() hook (React context)
 *   - backgroundInsightTask (TaskManager context, no React)
 *
 * @param ffiData - Pre-computed FFI data from engine.getInsightsData() or getStartupData()
 * @param wellnessData - Wellness entries (from TanStack Query or direct API fetch)
 * @param t - Translation function (from useTranslation() or i18n.t directly)
 * @returns Ranked array of insights
 */
export function computeInsightsFromData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ffiData: any,
  wellnessData: WellnessInput[] | null,
  t: TFunc
): Insight[] {
  if (!ffiData) return [];

  try {
    // Convert FFI bigint fields to number
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
      count: Math.round(ffiData.chronicPeriod.count / 4),
      totalDuration: Number(ffiData.chronicPeriod.totalDuration) / 4,
      totalDistance: ffiData.chronicPeriod.totalDistance / 4,
      totalTss: ffiData.chronicPeriod.totalTss / 4,
    };

    // Rest day detection
    const isRestDay = ffiData.todayPeriod.count === 0;

    // Compute CTL/ATL/TSB from wellness
    const sortedWellness = (wellnessData ?? []).sort((a, b) => a.id.localeCompare(b.id));
    const latestWellness =
      sortedWellness.length > 0 ? sortedWellness[sortedWellness.length - 1] : null;
    const ctl = latestWellness?.ctl ?? latestWellness?.ctlLoad ?? 0;
    const atl = latestWellness?.atl ?? latestWellness?.atlLoad ?? 0;
    const tsb = ctl - atl;

    // Section readiness check
    const engine = getRouteEngine();
    const sectionCount = engine?.getStats()?.sectionCount ?? 0;
    const sectionsReady = sectionCount > 0;

    // Get disabled section IDs to filter them out of all section-based insights
    const disabledIds = useDisabledSections.getState().disabledIds;

    // Type the patterns array
    const allPatterns = (ffiData.allPatterns ?? []) as Array<{
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

    // Build section trends from ML-ranked sections
    const sectionTrendMap = new Map<
      string,
      {
        sectionId: string;
        sectionName: string;
        trend: number;
        medianRecentSecs: number;
        bestTimeSecs: number;
        traversalCount: number;
        sportType?: string;
        daysSinceLast?: number;
      }
    >();

    if (sectionsReady && engine) {
      const sportTypes =
        allPatterns.length > 0
          ? [...new Set(allPatterns.map((p) => p.sportType))]
          : ['Ride', 'Run'];

      for (const sport of sportTypes) {
        const ranked = engine.getRankedSections(sport, 50);
        for (const rs of ranked) {
          if (!rs.sectionId || disabledIds.has(rs.sectionId)) continue;
          if (!sectionTrendMap.has(rs.sectionId)) {
            sectionTrendMap.set(rs.sectionId, {
              sectionId: rs.sectionId,
              sectionName: rs.sectionName || 'Section',
              trend: rs.trend,
              medianRecentSecs: rs.medianRecentSecs,
              bestTimeSecs: rs.bestTimeSecs,
              traversalCount: rs.traversalCount,
              sportType: sport,
              daysSinceLast: rs.daysSinceLast,
            });
          }
        }
      }
    }

    // Fallback: pattern-based commonSections
    if (sectionTrendMap.size === 0 && sectionsReady) {
      for (const pattern of allPatterns) {
        if (!pattern.commonSections) continue;
        for (const section of pattern.commonSections) {
          if (section.trend == null || !section.sectionId || disabledIds.has(section.sectionId))
            continue;
          const existing = sectionTrendMap.get(section.sectionId);
          if (!existing || section.traversalCount > existing.traversalCount) {
            sectionTrendMap.set(section.sectionId, {
              sectionId: section.sectionId,
              sectionName: section.sectionName || 'Section',
              trend: section.trend,
              medianRecentSecs: section.medianRecentSecs,
              bestTimeSecs: section.bestTimeSecs,
              traversalCount: section.traversalCount,
              sportType: pattern.sportType,
            });
          }
        }
      }
    }

    const sectionTrends = Array.from(sectionTrendMap.values());

    // 7-day wellness window
    const wellnessWindow = sortedWellness.slice(-7).map((w) => ({
      date: w.id,
      hrv: w.hrv ?? undefined,
      restingHR: w.restingHR ?? undefined,
      sleepSecs: w.sleepSecs ?? undefined,
      ctl: w.ctl ?? w.ctlLoad ?? undefined,
      atl: w.atl ?? w.atlLoad ?? undefined,
    }));

    // Tomorrow's pattern prediction
    const now = new Date();
    const tomorrowDayJs = (now.getDay() + 1) % 7;
    const tomorrowDayMon = tomorrowDayJs === 0 ? 6 : tomorrowDayJs - 1;
    const tomorrowPattern =
      allPatterns.find((p) => p.primaryDay === tomorrowDayMon && p.confidence >= 0.6) ?? null;

    // Recent PRs (skip if sections aren't loaded, filter out disabled)
    const recentPRs = sectionsReady
      ? (
          (ffiData.recentPrs ?? []) as Array<{
            sectionId: string;
            sectionName: string;
            bestTime: number;
            daysAgo: number;
          }>
        )
          .filter((pr) => !disabledIds.has(pr.sectionId))
          .map((pr) => ({
            sectionId: pr.sectionId,
            sectionName: pr.sectionName,
            bestTime: pr.bestTime,
            daysAgo: pr.daysAgo,
          }))
      : [];

    // Aerobic efficiency section IDs
    let efficiencyTrendSectionIds: string[] = [];
    if (sectionsReady && engine) {
      const sportTypes =
        allPatterns.length > 0
          ? [...new Set(allPatterns.map((p) => p.sportType))]
          : ['Ride', 'Run'];
      for (const sport of sportTypes) {
        const ranked = engine.getRankedSections(sport, 5);
        for (const rs of ranked) {
          if (!disabledIds.has(rs.sectionId) && !efficiencyTrendSectionIds.includes(rs.sectionId)) {
            efficiencyTrendSectionIds.push(rs.sectionId);
          }
        }
      }
    }

    return generateInsights(
      {
        currentPeriod: toPeriod(ffiData.currentWeek),
        previousPeriod: toPeriod(ffiData.previousWeek),
        ftpTrend: ffiData.ftpTrend ?? null,
        paceTrend: ffiData.runPaceTrend ?? null,
        recentPRs,
        todayPattern: ffiData.todayPattern ?? null,
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
        allPatterns: allPatterns.map((p) => ({
          sportType: p.sportType,
          primaryDay: p.primaryDay,
          avgDurationSecs: p.avgDurationSecs,
          confidence: p.confidence,
          activityCount: p.activityCount,
        })),
        efficiencyTrendSectionIds,
      },
      t
    );
  } catch {
    return [];
  }
}

/**
 * Fetch FFI insights data from the engine.
 * Pure function — calls synchronous FFI, no React.
 */
export function fetchInsightsDataFromEngine(): ReturnType<
  NonNullable<ReturnType<typeof getRouteEngine>>['getInsightsData']
> | null {
  const engine = getRouteEngine();
  if (!engine) return null;

  const now = new Date();
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - day + (day === 0 ? -6 : 1));
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  const fourWeeksAgo = new Date(startOfWeek);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const toTs = (d: Date) => Math.floor(d.getTime() / 1000);

  return (
    engine.getInsightsData(
      toTs(startOfWeek),
      toTs(now),
      toTs(startOfLastWeek),
      toTs(startOfWeek),
      toTs(fourWeeksAgo),
      toTs(todayStart)
    ) ?? null
  );
}
