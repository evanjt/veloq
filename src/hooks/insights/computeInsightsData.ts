import { getRouteEngine } from '@/lib/native/routeEngine';
import { isRouteMatchingEnabled } from '@/providers/RouteSettingsStore';
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

/** Matches FfiPeriodStats shape from veloqrs generated bindings */
interface FfiPeriodStatsShape {
  count: number;
  totalDuration: bigint | number;
  totalDistance: number;
  totalTss: number;
}

/** Matches FfiPaceTrend shape from veloqrs generated bindings */
interface FfiPaceTrendShape {
  latestPace: number | undefined;
  latestDate: bigint | number | undefined;
  previousPace: number | undefined;
  previousDate: bigint | number | undefined;
}

/** Matches FfiActivityPattern shape from veloqrs generated bindings */
interface FfiActivityPatternShape {
  primaryDay: number;
  confidence: number;
  sportType: string;
  avgDurationSecs: number;
  activityCount: number;
  commonSections?: Array<{
    sectionId: string;
    sectionName: string;
    trend: number | undefined;
    medianRecentSecs: number;
    bestTimeSecs: number;
    traversalCount: number;
  }>;
}

/** Matches FfiInsightsData shape from veloqrs generated bindings */
export interface FfiInsightsDataShape {
  currentWeek: FfiPeriodStatsShape;
  previousWeek: FfiPeriodStatsShape;
  chronicPeriod: FfiPeriodStatsShape;
  todayPeriod: FfiPeriodStatsShape;
  ftpTrend: {
    latestFtp: number | undefined;
    latestDate: bigint | number | undefined;
    previousFtp: number | undefined;
    previousDate: bigint | number | undefined;
  };
  runPaceTrend: FfiPaceTrendShape;
  swimPaceTrend?: FfiPaceTrendShape;
  allPatterns: FfiActivityPatternShape[];
  todayPattern: FfiActivityPatternShape | null | undefined;
  recentPrs: Array<{
    sectionId: string;
    sectionName: string;
    bestTime: number;
    daysAgo: number;
  }>;
}

/** Matches FfiSummaryCardData shape from veloqrs generated bindings */
export interface FfiSummaryCardDataShape {
  currentWeek: FfiPeriodStatsShape;
  prevWeek: FfiPeriodStatsShape;
  ftpTrend: FfiInsightsDataShape['ftpTrend'];
  runPaceTrend: FfiPaceTrendShape;
  swimPaceTrend: FfiPaceTrendShape;
}

/** Shape returned by getRankedSections() */
interface RankedSectionShape {
  sectionId: string;
  sectionName: string;
  trend: number;
  medianRecentSecs: number;
  bestTimeSecs: number;
  traversalCount: number;
  daysSinceLast?: number;
  latestIsPr?: boolean;
}

interface InsightsEnginePayload {
  insightsData: FfiInsightsDataShape;
  summaryCardData: FfiSummaryCardDataShape | null;
}

// Module-level cache for fetchInsightsDataFromEngine results.
// Avoids redundant FFI calls when called multiple times between engine updates.
let _cachedPayload: InsightsEnginePayload | null = null;
let _cacheTimestamp = 0;
const INSIGHTS_CACHE_TTL_MS = 30_000; // 30 seconds

// Module-level cache for section/strength data fetched during computeInsightsFromData.
// These FFI calls (getRankedSections per sport, getStrengthSummary x5) are expensive
// and their results only change when the engine data changes.
let _cachedSectionTrends: Array<{
  sectionId: string;
  sectionName: string;
  trend: number;
  medianRecentSecs: number;
  bestTimeSecs: number;
  traversalCount: number;
  sportType?: string;
  daysSinceLast?: number;
  latestIsPr?: boolean;
}> | null = null;
let _cachedEfficiencyIds: string[] | null = null;
let _cachedStrengthInsights: Insight[] | null = null;
let _computeCacheTimestamp = 0;

/**
 * Invalidate the cached insights engine payload.
 * Call when engine data changes (new sync, etc).
 */
export function invalidateInsightsCache(): void {
  _cachedPayload = null;
  _cacheTimestamp = 0;
  _cachedSectionTrends = null;
  _cachedEfficiencyIds = null;
  _cachedStrengthInsights = null;
  _computeCacheTimestamp = 0;
}

const MAX_SECTION_STORY_INSIGHTS = 2;

function isSectionStoryInsight(insight: Insight): boolean {
  return insight.category === 'stale_pr' || insight.category === 'efficiency_trend';
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

  const kept: Insight[] = [];
  const dropped: Array<{ id: string; category: string; reason: string }> = [];
  const seenSectionIds = new Set<string>();
  let keptSectionStories = 0;

  for (const insight of sorted) {
    if (insight.category === 'section_pr') {
      getInsightSectionIds(insight).forEach((sectionId) => seenSectionIds.add(sectionId));
      kept.push(insight);
      continue;
    }

    if (isSectionStoryInsight(insight)) {
      if (keptSectionStories >= MAX_SECTION_STORY_INSIGHTS) {
        dropped.push({
          id: insight.id,
          category: insight.category,
          reason: `section story limit (max ${MAX_SECTION_STORY_INSIGHTS})`,
        });
        continue;
      }

      const sectionIds = getInsightSectionIds(insight);
      if (sectionIds.length > 0 && sectionIds.every((sectionId) => seenSectionIds.has(sectionId))) {
        dropped.push({
          id: insight.id,
          category: insight.category,
          reason: 'duplicate section (already covered by PR insight)',
        });
        continue;
      }

      kept.push(insight);
      keptSectionStories += 1;
      sectionIds.forEach((sectionId) => seenSectionIds.add(sectionId));
      continue;
    }

    kept.push(insight);
  }

  if (__DEV__ && dropped.length > 0) {
    console.log(`[INSIGHTS] Consolidation dropped ${dropped.length} insights:`);
    for (const d of dropped) {
      console.log(`[INSIGHTS]   ${d.category}/${d.id} — ${d.reason}`);
    }
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
  ffiData: FfiInsightsDataShape | null,
  wellnessData: WellnessInput[] | null,
  t: TFunc,
  summaryCardData?: FfiSummaryCardDataShape | null
): Insight[] {
  if (!ffiData) return [];

  try {
    // Convert FFI bigint fields to number
    const toPeriod = (p: FfiPeriodStatsShape) => ({
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

    // Compute CTL/ATL/TSB from wellness
    const sortedWellness = (wellnessData ?? []).sort((a, b) => a.id.localeCompare(b.id));
    const latestWellness =
      sortedWellness.length > 0 ? sortedWellness[sortedWellness.length - 1] : null;
    const ctl = latestWellness?.ctl ?? latestWellness?.ctlLoad ?? 0;
    const atl = latestWellness?.atl ?? latestWellness?.atlLoad ?? 0;
    const tsb = ctl - atl;

    // Section readiness check — skip when route matching is disabled
    const engine = getRouteEngine();
    const routeMatchingOn = isRouteMatchingEnabled();
    const sectionCount = routeMatchingOn ? (engine?.getStats()?.sectionCount ?? 0) : 0;
    const sectionsReady = sectionCount > 0;

    const allPatterns = ffiData.allPatterns ?? [];

    // Use cached section trends and efficiency IDs when available (saves ~5 FFI calls).
    // The cache is invalidated by invalidateInsightsCache() when engine data changes.
    const computeNow = Date.now();
    const useComputeCache =
      _cachedSectionTrends !== null &&
      _cachedEfficiencyIds !== null &&
      computeNow - _computeCacheTimestamp < INSIGHTS_CACHE_TTL_MS;

    let sectionTrends: typeof _cachedSectionTrends;
    let efficiencyTrendSectionIds: string[];

    if (useComputeCache) {
      sectionTrends = _cachedSectionTrends!;
      efficiencyTrendSectionIds = _cachedEfficiencyIds!;
    } else {
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

      // Cache ranked sections per sport to avoid duplicate FFI calls below
      const rankedSectionsCache = new Map<string, RankedSectionShape[]>();

      if (sectionsReady && engine) {
        const patternSports =
          allPatterns.length > 0 ? [...new Set(allPatterns.map((p) => p.sportType))] : [];
        const sportTypes =
          patternSports.length > 0
            ? patternSports
            : (engine.getAvailableSportTypes?.() ?? ['Ride', 'Run']);

        // Single FFI round-trip for all sports.
        const batches = engine.getRankedSectionsBatch(sportTypes, 50);
        for (const { sportType, sections } of batches) {
          rankedSectionsCache.set(sportType, sections);
          for (const rs of sections) {
            if (!rs.sectionId) continue;
            if (!sectionTrendMap.has(rs.sectionId)) {
              sectionTrendMap.set(rs.sectionId, {
                sectionId: rs.sectionId,
                sectionName: rs.sectionName || 'Section',
                trend: rs.trend,
                medianRecentSecs: rs.medianRecentSecs,
                bestTimeSecs: rs.bestTimeSecs,
                traversalCount: rs.traversalCount,
                sportType,
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

      sectionTrends = Array.from(sectionTrendMap.values());

      // Aerobic efficiency section IDs — reuse cached ranked sections from above
      efficiencyTrendSectionIds = [];
      for (const [, cached] of rankedSectionsCache) {
        for (const rs of cached.slice(0, 5)) {
          if (!efficiencyTrendSectionIds.includes(rs.sectionId)) {
            efficiencyTrendSectionIds.push(rs.sectionId);
          }
        }
      }

      // Persist to module-level cache
      _cachedSectionTrends = sectionTrends;
      _cachedEfficiencyIds = efficiencyTrendSectionIds;
      _computeCacheTimestamp = computeNow;
    }

    // 7-day wellness window
    const wellnessWindow = sortedWellness.slice(-7).map((w) => ({
      date: w.id,
      hrv: w.hrv ?? undefined,
      restingHR: w.restingHR ?? undefined,
      sleepSecs: w.sleepSecs ?? undefined,
      ctl: w.ctl ?? w.ctlLoad ?? undefined,
      atl: w.atl ?? w.atlLoad ?? undefined,
    }));

    // Recent PRs (skip if sections aren't loaded)
    const recentPRs = sectionsReady
      ? (ffiData.recentPrs ?? []).map((pr) => ({
          sectionId: pr.sectionId,
          sectionName: pr.sectionName,
          bestTime: pr.bestTime,
          daysAgo: pr.daysAgo,
        }))
      : [];

    const coreInsights = generateInsights(
      {
        currentPeriod: toPeriod(ffiData.currentWeek),
        previousPeriod: toPeriod(ffiData.previousWeek),
        ftpTrend: ffiData.ftpTrend ?? null,
        paceTrend: ffiData.runPaceTrend ?? null,
        swimPaceTrend: ffiData.swimPaceTrend ?? summaryCardData?.swimPaceTrend ?? null,
        recentPRs,
        sectionTrends,
        formTsb: latestWellness ? tsb : null,
        formCtl: ctl > 0 ? ctl : null,
        formAtl: atl > 0 ? atl : null,
        peakCtl: null,
        currentCtl: ctl > 0 ? ctl : null,
        wellnessWindow,
        chronicPeriod,
        allSectionTrends: sectionTrends,
        efficiencyTrendSectionIds,
      },
      t
    );

    // Strength insights: single FFI call returns monthly + 4 weekly summaries.
    let strengthInsights: Insight[] = [];
    if (useComputeCache && _cachedStrengthInsights !== null) {
      strengthInsights = _cachedStrengthInsights;
    } else if (
      engine &&
      typeof engine.hasStrengthData === 'function' &&
      typeof engine.getStrengthInsightSeries === 'function'
    ) {
      try {
        if (engine.hasStrengthData()) {
          const series = engine.getStrengthInsightSeries(
            getTrailingMonthRange(),
            getTrailingStrengthRanges()
          );
          const monthlySummary = normalizeStrengthSummary(series.monthly);
          const weeklySummaries = series.weekly.map(normalizeStrengthSummary);
          strengthInsights = generateStrengthInsights(monthlySummary, weeklySummaries, Date.now());
        }
      } catch {
        strengthInsights = [];
      }
      _cachedStrengthInsights = strengthInsights;
    }

    const consolidated = consolidateInsights([...coreInsights, ...strengthInsights]);

    if (__DEV__) {
      console.log(
        `[INSIGHTS] Final: ${consolidated.length} insights (${coreInsights.length} core + ${strengthInsights.length} strength, after consolidation)`
      );
      for (const i of consolidated) {
        console.log(
          `[INSIGHTS]   ${i.category}/${i.id} — P${i.priority} "${i.title.slice(0, 60)}"`
        );
      }
    }

    return consolidated;
  } catch (err) {
    if (typeof process !== 'undefined' && process.env?.VELOQ_INSIGHTS_DEBUG) {
      // eslint-disable-next-line no-console
      console.error('[computeInsightsFromData] swallowed error:', err);
    }
    return [];
  }
}

/**
 * Fetch FFI insights data from the engine.
 * Pure function — calls synchronous FFI, no React.
 *
 * Results are cached for 30 seconds to avoid redundant FFI calls when
 * the routes tab re-renders without engine data having changed.
 */
export function fetchInsightsDataFromEngine(): InsightsEnginePayload | null {
  // Return cached result if still fresh
  const now = Date.now();
  if (_cachedPayload && now - _cacheTimestamp < INSIGHTS_CACHE_TTL_MS) {
    return _cachedPayload;
  }

  const engine = getRouteEngine();
  if (!engine) return null;

  const nowDate = new Date();
  const startOfWeek = new Date(nowDate);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - day + (day === 0 ? -6 : 1));
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  const fourWeeksAgo = new Date(startOfWeek);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const todayStart = new Date(nowDate);
  todayStart.setHours(0, 0, 0, 0);

  const toTs = (d: Date) => Math.floor(d.getTime() / 1000);

  const currentStart = toTs(startOfWeek);
  const currentEnd = toTs(nowDate);
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

  const payload: InsightsEnginePayload = {
    insightsData,
    summaryCardData: engine.getSummaryCardData(currentStart, currentEnd, prevStart, prevEnd),
  };

  _cachedPayload = payload;
  _cacheTimestamp = now;

  return payload;
}
