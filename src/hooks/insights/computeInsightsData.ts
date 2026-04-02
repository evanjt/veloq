import { getRouteEngine } from '@/lib/native/routeEngine';
import { generateInsights } from './generateInsights';
import { generateStrengthInsights } from './strengthInsights';
import type { Insight } from '@/types';
import type { StrengthSummary } from '@/types';

type TFunc = (key: string, params?: Record<string, string | number>) => string;

function getTrailingStrengthRanges(): Array<{ startTs: number; endTs: number }> {
  const end = new Date();
  end.setHours(23, 59, 59, 0);

  const ranges: Array<{ startTs: number; endTs: number }> = [];
  for (let index = 3; index >= 0; index -= 1) {
    const rangeEnd = new Date(end);
    rangeEnd.setDate(rangeEnd.getDate() - index * 7);

    const rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 6);
    rangeStart.setHours(0, 0, 0, 0);

    ranges.push({
      startTs: Math.floor(rangeStart.getTime() / 1000),
      endTs: Math.floor(rangeEnd.getTime() / 1000),
    });
  }

  return ranges;
}

function getTrailingMonthRange(): { startTs: number; endTs: number } {
  const end = new Date();
  end.setHours(23, 59, 59, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 27);
  start.setHours(0, 0, 0, 0);

  return {
    startTs: Math.floor(start.getTime() / 1000),
    endTs: Math.floor(end.getTime() / 1000),
  };
}

function normalizeStrengthSummary(raw: {
  muscleVolumes?: Array<{
    slug: string;
    primarySets: number;
    secondarySets: number;
    weightedSets: number;
    totalReps: number;
    totalWeightKg: number;
    exerciseNames: string[];
  }>;
  activityCount?: number;
  totalSets?: number;
}): StrengthSummary {
  return {
    muscleVolumes: (raw.muscleVolumes ?? []).map((volume) => ({
      slug: volume.slug,
      primarySets: volume.primarySets,
      secondarySets: volume.secondarySets,
      weightedSets: volume.weightedSets,
      totalReps: volume.totalReps,
      totalWeightKg: volume.totalWeightKg,
      exerciseNames: volume.exerciseNames,
    })),
    activityCount: raw.activityCount ?? 0,
    totalSets: raw.totalSets ?? 0,
  };
}

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

interface InsightsEnginePayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insightsData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summaryCardData: any | null;
}

const MAX_SECTION_STORY_INSIGHTS = 2;

function isSectionStoryInsight(insight: Insight): boolean {
  return (
    insight.category === 'stale_pr' ||
    insight.category === 'section_cluster' ||
    insight.category === 'efficiency_trend'
  );
}

function getInsightSectionIds(insight: Insight): string[] {
  const sections = insight.supportingData?.sections ?? [];
  const sectionIds = sections
    .map((section) => section.sectionId)
    .filter((sectionId): sectionId is string => !!sectionId);

  if (sectionIds.length > 0) return sectionIds;

  if (insight.navigationTarget?.startsWith('/section/')) {
    return [insight.navigationTarget.replace('/section/', '')];
  }

  return [];
}

export function consolidateInsights(insights: Insight[]): Insight[] {
  if (insights.length <= 1) return insights;

  const sorted = [...insights].sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp);
  const hasPeriodComparison = sorted.some((insight) => insight.category === 'period_comparison');

  const kept: Insight[] = [];
  const seenSectionIds = new Set<string>();
  let keptSectionStories = 0;

  for (const insight of sorted) {
    if (insight.category === 'intensity_context' && hasPeriodComparison) {
      continue;
    }

    if (insight.category === 'section_pr') {
      getInsightSectionIds(insight).forEach((sectionId) => seenSectionIds.add(sectionId));
      kept.push(insight);
      continue;
    }

    if (isSectionStoryInsight(insight)) {
      if (keptSectionStories >= MAX_SECTION_STORY_INSIGHTS) {
        continue;
      }

      const sectionIds = getInsightSectionIds(insight);
      if (sectionIds.length > 0 && sectionIds.every((sectionId) => seenSectionIds.has(sectionId))) {
        continue;
      }

      kept.push(insight);
      keptSectionStories += 1;
      sectionIds.forEach((sectionId) => seenSectionIds.add(sectionId));
      continue;
    }

    kept.push(insight);
  }

  return kept;
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
  t: TFunc,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summaryCardData?: any | null
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
        latestIsPr?: boolean;
      }
    >();

    if (sectionsReady && engine) {
      const patternSports =
        allPatterns.length > 0 ? [...new Set(allPatterns.map((p) => p.sportType))] : [];
      const sportTypes =
        patternSports.length > 0
          ? patternSports
          : (engine.getAvailableSportTypes?.() ?? ['Ride', 'Run']);

      for (const sport of sportTypes) {
        const ranked = engine.getRankedSections(sport, 50);
        for (const rs of ranked) {
          if (!rs.sectionId) continue;
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
              latestIsPr: rs.latestIsPr,
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

    // Recent PRs (skip if sections aren't loaded)
    const recentPRs = sectionsReady
      ? (
          (ffiData.recentPrs ?? []) as Array<{
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
        }))
      : [];

    // Aerobic efficiency section IDs
    let efficiencyTrendSectionIds: string[] = [];
    if (sectionsReady && engine) {
      const patternSports =
        allPatterns.length > 0 ? [...new Set(allPatterns.map((p) => p.sportType))] : [];
      const sportTypes =
        patternSports.length > 0
          ? patternSports
          : (engine.getAvailableSportTypes?.() ?? ['Ride', 'Run']);
      for (const sport of sportTypes) {
        const ranked = engine.getRankedSections(sport, 5);
        for (const rs of ranked) {
          if (!efficiencyTrendSectionIds.includes(rs.sectionId)) {
            efficiencyTrendSectionIds.push(rs.sectionId);
          }
        }
      }
    }

    const coreInsights = generateInsights(
      {
        currentPeriod: toPeriod(ffiData.currentWeek),
        previousPeriod: toPeriod(ffiData.previousWeek),
        ftpTrend: ffiData.ftpTrend ?? null,
        paceTrend: ffiData.runPaceTrend ?? null,
        swimPaceTrend: ffiData.swimPaceTrend ?? summaryCardData?.swimPaceTrend ?? null,
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

    let strengthInsights: Insight[] = [];
    if (
      engine &&
      typeof engine.hasStrengthData === 'function' &&
      typeof engine.getStrengthSummary === 'function'
    ) {
      try {
        if (engine.hasStrengthData()) {
          const monthlyRange = getTrailingMonthRange();
          const monthlySummary = normalizeStrengthSummary(
            engine.getStrengthSummary(monthlyRange.startTs, monthlyRange.endTs)
          );
          const weeklySummaries = getTrailingStrengthRanges().map((range) =>
            normalizeStrengthSummary(engine.getStrengthSummary(range.startTs, range.endTs))
          );
          strengthInsights = generateStrengthInsights(monthlySummary, weeklySummaries, Date.now());
        }
      } catch {
        strengthInsights = [];
      }
    }

    return consolidateInsights([...coreInsights, ...strengthInsights]);
  } catch {
    return [];
  }
}

/**
 * Fetch FFI insights data from the engine.
 * Pure function — calls synchronous FFI, no React.
 */
export function fetchInsightsDataFromEngine(): InsightsEnginePayload | null {
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

  const currentStart = toTs(startOfWeek);
  const currentEnd = toTs(now);
  const prevStart = toTs(startOfLastWeek);
  const prevEnd = toTs(startOfWeek);
  const chronicStart = toTs(fourWeeksAgo);
  const todayStartTs = toTs(todayStart);

  const insightsData =
    engine.getInsightsData(
      currentStart,
      currentEnd,
      prevStart,
      prevEnd,
      chronicStart,
      todayStartTs
    ) ?? null;

  if (!insightsData) return null;

  return {
    insightsData,
    summaryCardData: engine.getSummaryCardData(currentStart, currentEnd, prevStart, prevEnd),
  };
}
