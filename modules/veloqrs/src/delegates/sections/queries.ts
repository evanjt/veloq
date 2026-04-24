/**
 * Section query delegates (read-only).
 *
 * Pure read operations over sections: CRUD list/get, polylines, performances,
 * efficiency trends, calendar summaries, reference info, nearby/merge
 * candidates, matching queries, indicators, encounters, and trace extraction.
 * No mutations emitted from this module.
 */

import { flatCoordsToPoints, validateId } from '../../conversions';
import type { RoutePoint } from '../../conversions';
import type {
  FfiCalendarSummary,
  FfiEfficiencyTrend,
  FfiFrequentSection,
  FfiGpsPoint,
  FfiRankedSection,
  FfiSection,
  FfiSectionPerformanceResult,
  SectionSummary,
} from '../../generated/veloqrs';
import type { DelegateHost } from '../host';
import type {
  FfiActivityIndicator,
  FfiActivitySectionHighlight,
  FfiMergeCandidate,
  FfiNearbySectionSummary,
  FfiSectionMatch,
  SectionEncounter,
} from '../shared-types';

const EMPTY_SECTION_PERFORMANCE_RESULT: FfiSectionPerformanceResult = {
  records: [],
  bestRecord: undefined,
  bestForwardRecord: undefined,
  bestReverseRecord: undefined,
  forwardStats: undefined,
  reverseStats: undefined,
};

export function getSections(host: DelegateHost): FfiFrequentSection[] {
  if (!host.ready) return [];
  return host.timed('getSections', () => host.engine.sections().getAll());
}

export function getSectionsFiltered(
  host: DelegateHost,
  sportType?: string,
  minVisits?: number
): FfiFrequentSection[] {
  if (!host.ready) return [];
  // FfiConverterOptional* accepts undefined for "absent" but throws on null —
  // forward optional args as-is, do NOT coalesce to null.
  return host.timed('getSectionsFiltered', () =>
    host.engine.sections().getFiltered(sportType, minVisits)
  );
}

export function getSectionsForActivity(host: DelegateHost, activityId: string): FfiSection[] {
  if (!host.ready) return [];
  return host.timed('getSectionsForActivity', () =>
    host.engine.sections().getForActivity(activityId)
  );
}

export function getSectionSummaries(
  host: DelegateHost,
  sportType?: string
): { totalCount: number; summaries: SectionSummary[] } {
  if (!host.ready) return { totalCount: 0, summaries: [] };
  return host.timed('getSectionSummaries', () =>
    host.engine.sections().getSummariesWithCount(sportType)
  );
}

export type SectionSortKey = 'visits' | 'distance' | 'name';

/**
 * Filtered + sorted section summaries in a single FFI call. Visit-count
 * threshold and sort key are applied in Rust so `useSectionSummaries` /
 * `useFrequentSections` stop re-iterating in TS.
 */
export function getFilteredSectionSummaries(
  host: DelegateHost,
  sportType: string | undefined,
  minVisits: number,
  sortKey: SectionSortKey
): { totalCount: number; summaries: SectionSummary[] } {
  if (!host.ready) return { totalCount: 0, summaries: [] };
  return host.timed('getFilteredSectionSummaries', () =>
    host.engine.sections().getFilteredSummaries(sportType, minVisits, sortKey)
  );
}

export interface RankedSectionsBySport {
  sportType: string;
  sections: FfiRankedSection[];
}

export function getRankedSectionsBatch(
  host: DelegateHost,
  sportTypes: string[],
  limit: number
): RankedSectionsBySport[] {
  if (!host.ready || sportTypes.length === 0) return [];
  return host.timed('getRankedSectionsBatch', () =>
    host.engine.sections().getRankedBatch(sportTypes, limit)
  );
}

export function getRankedSections(
  host: DelegateHost,
  sportType: string,
  limit: number
): FfiRankedSection[] {
  if (!host.ready) return [];
  return host.timed('getRankedSections', () => host.engine.sections().getRanked(sportType, limit));
}

export function getSectionById(host: DelegateHost, sectionId: string): FfiFrequentSection | null {
  if (!host.ready) return null;
  validateId(sectionId, 'section ID');
  return host.timed('getSectionById', () => host.engine.sections().getById(sectionId)) ?? null;
}

export function getSectionPolyline(host: DelegateHost, sectionId: string): FfiGpsPoint[] {
  if (!host.ready) return [];
  validateId(sectionId, 'section ID');
  return host.timed('getSectionPolyline', () => host.engine.sections().getPolyline(sectionId));
}

export function getAllSectionNames(host: DelegateHost): Record<string, string> {
  if (!host.ready) return {};
  const map = host.timed('getAllSectionNames', () => host.engine.sections().getAllNames());
  return Object.fromEntries(map);
}

export function getAllSectionsIncludingHidden(
  host: DelegateHost,
  sportType?: string
): SectionSummary[] {
  if (!host.ready) return [];
  return host.timed('getAllSectionsIncludingHidden', () =>
    host.engine.sections().getAllSummariesIncludingHidden(sportType)
  );
}

export function getSectionsByType(
  host: DelegateHost,
  sectionType?: 'auto' | 'custom'
): FfiSection[] {
  if (!host.ready) return [];
  return host.timed('getSectionsByType', () => host.engine.sections().getByType(sectionType));
}

export function getSectionPerformances(
  host: DelegateHost,
  sectionId: string,
  sportType?: string
): FfiSectionPerformanceResult {
  if (!host.ready) {
    return EMPTY_SECTION_PERFORMANCE_RESULT;
  }
  return host.timed('getSectionPerformances', () =>
    host.engine.sections().getPerformances(sectionId, sportType)
  );
}

/**
 * Batched section-performance fetch. One FFI round-trip for many section
 * IDs instead of N. Backed by `SectionManager.get_performances_batch`.
 * Returns one entry per requested id, in the same order.
 */
export function getPerformancesBatch(
  host: DelegateHost,
  sectionIds: string[],
  sportType?: string
): Array<{ sectionId: string; result: FfiSectionPerformanceResult }> {
  if (!host.ready || sectionIds.length === 0) return [];
  return host.timed('getPerformancesBatch', () =>
    host.engine.sections().getPerformancesBatch(sectionIds, sportType)
  );
}

export function getActivityPrSections(
  host: DelegateHost,
  activityId: string,
  sectionIds: string[]
): string[] {
  if (!host.ready || sectionIds.length === 0) return [];
  return host.timed('getActivityPrSections', () =>
    host.engine.sections().getActivityPrSections(activityId, sectionIds)
  );
}

export interface FfiWorkoutSection {
  id: string;
  name: string;
  prTimeSecs?: number;
  previousBestTimeSecs?: number;
  lastTimeSecs?: number;
  daysSinceLast?: number;
  prDaysAgo?: number;
  /** "improving" | "stable" | "declining" | "" */
  trend: string;
}

export function getWorkoutSections(
  host: DelegateHost,
  sportType: string,
  limit: number
): FfiWorkoutSection[] {
  if (!host.ready) return [];
  return host.timed('getWorkoutSections', () =>
    host.engine.sections().getWorkoutSections(sportType, limit)
  );
}

export interface FfiSectionChartPoint {
  lapId: string;
  activityId: string;
  activityName: string;
  activityDate: number;
  speed: number;
  sectionTime: number;
  sectionDistance: number;
  direction: string;
  rank: number;
}

export interface FfiSectionChartData {
  points: FfiSectionChartPoint[];
  minSpeed: number;
  maxSpeed: number;
  bestIndex: number;
  hasReverseRuns: boolean;
  bestActivityId?: string;
  bestTimeSecs?: number;
  bestPace?: number;
  averageTimeSecs?: number;
  lastActivityDate?: number;
  totalActivities: number;
}

const EMPTY_CHART: FfiSectionChartData = {
  points: [],
  minSpeed: 0,
  maxSpeed: 1,
  bestIndex: 0,
  hasReverseRuns: false,
  totalActivities: 0,
};

/**
 * Pre-computed chart payload for the section-detail screen: per-lap points,
 * speed ranks, best/avg/last stats, all in one FFI round-trip. The TS hook
 * (`useSectionChartData`) becomes a thin pass-through for the render layer.
 */
export function getSectionChartData(
  host: DelegateHost,
  sectionId: string,
  timeRangeDays: number,
  sportFilter?: string
): FfiSectionChartData {
  if (!host.ready) return EMPTY_CHART;
  return host.timed('getSectionChartData', () =>
    host.engine.sections().getChartData(sectionId, timeRangeDays, sportFilter)
  );
}

export function getSectionEfficiencyTrend(
  host: DelegateHost,
  sectionId: string
): FfiEfficiencyTrend | null {
  if (!host.ready) {
    return null;
  }
  return host.timed(
    'getSectionEfficiencyTrend',
    () => host.engine.sections().getEfficiencyTrend(sectionId) ?? null
  );
}

export function getExcludedSectionPerformances(
  host: DelegateHost,
  sectionId: string
): FfiSectionPerformanceResult {
  if (!host.ready) {
    return EMPTY_SECTION_PERFORMANCE_RESULT;
  }
  return host.timed('getExcludedSectionPerformances', () =>
    host.engine.sections().getExcludedPerformances(sectionId)
  );
}

export function getSectionCalendarSummary(
  host: DelegateHost,
  sectionId: string
): FfiCalendarSummary | null {
  if (!host.ready) return null;
  return (
    host.timed('getSectionCalendarSummary', () =>
      host.engine.sections().getCalendarSummary(sectionId)
    ) ?? null
  );
}

export function getSectionReferenceInfo(
  host: DelegateHost,
  sectionId: string
): { activityId?: string; isUserDefined: boolean } {
  if (!host.ready) return { activityId: undefined, isUserDefined: false };
  validateId(sectionId, 'section ID');
  const info = host.timed('getSectionReferenceInfo', () =>
    host.engine.sections().getReferenceInfo(sectionId)
  );
  return { activityId: info?.activityId, isUserDefined: info?.isUserDefined ?? false };
}

export function hasOriginalBounds(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  return host.timed('hasOriginalBounds', () => host.engine.sections().hasOriginalBounds(sectionId));
}

/**
 * Get the representative activity's full GPS track for section expansion.
 * Returns the track as flat coords [lat, lng, ...] + section start/end indices.
 */
export function getSectionExtensionTrack(
  host: DelegateHost,
  sectionId: string
): { track: number[]; sectionStartIdx: number; sectionEndIdx: number } | null {
  if (!host.ready) return null;
  validateId(sectionId, 'section ID');
  try {
    return host.timed('getSectionExtensionTrack', () => {
      const result = host.engine.sections().getExtensionTrack(sectionId);
      return {
        track: result.track,
        sectionStartIdx: result.sectionStartIdx,
        sectionEndIdx: result.sectionEndIdx,
      };
    });
  } catch (e) {
    console.error('[RouteEngine] getSectionExtensionTrack failed:', sectionId, e);
    return null;
  }
}

export function getExcludedActivityIds(host: DelegateHost, sectionId: string): string[] {
  if (!host.ready) return [];
  return host.timed('getExcludedActivityIds', () =>
    host.engine.sections().getExcludedActivities(sectionId)
  );
}

export function matchActivityToSections(host: DelegateHost, activityId: string): FfiSectionMatch[] {
  if (!host.ready) return [];
  validateId(activityId, 'activity ID');
  return host.timed('matchActivityToSections', () =>
    host.engine.sections().matchActivityToSections(activityId)
  );
}

export function getNearbySections(
  host: DelegateHost,
  sectionId: string,
  radiusMeters: number = 500
): FfiNearbySectionSummary[] {
  if (!host.ready) return [];
  validateId(sectionId, 'section ID');
  return host.timed('getNearbySections', () =>
    host.engine.sections().getNearbySections(sectionId, radiusMeters)
  );
}

export function getMergeCandidates(host: DelegateHost, sectionId: string): FfiMergeCandidate[] {
  if (!host.ready) return [];
  validateId(sectionId, 'section ID');
  return host.timed('getMergeCandidates', () =>
    host.engine.sections().getMergeCandidates(sectionId)
  );
}

export function getActivitySectionHighlights(
  host: DelegateHost,
  activityIds: string[]
): FfiActivitySectionHighlight[] {
  if (!host.ready || activityIds.length === 0) return [];
  return host.timed('getActivitySectionHighlights', () =>
    host.engine.sections().getActivitySectionHighlights(activityIds)
  );
}

/** Read pre-computed indicators for a batch of activity IDs (from materialized table). */
export function getActivityIndicators(
  host: DelegateHost,
  activityIds: string[]
): FfiActivityIndicator[] {
  if (!host.ready || activityIds.length === 0) return [];
  return host.timed('getActivityIndicators', () =>
    host.engine.sections().getActivityIndicators(activityIds)
  );
}

/** Read pre-computed indicators for a single activity. */
export function getIndicatorsForActivity(
  host: DelegateHost,
  activityId: string
): FfiActivityIndicator[] {
  if (!host.ready) return [];
  return host.timed('getIndicatorsForActivity', () =>
    host.engine.sections().getIndicatorsForActivity(activityId)
  );
}

/** Get section encounters for an activity: one entry per (section, direction). */
export function getActivitySectionEncounters(
  host: DelegateHost,
  activityId: string
): SectionEncounter[] {
  if (!host.ready || !activityId) return [];
  return host.timed('getActivitySectionEncounters', () => {
    const raw = host.engine.sections().getActivitySectionEncounters(activityId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return raw.map((e: any) => ({
      sectionId: e.sectionId,
      sectionName: e.sectionName,
      direction: e.direction,
      distanceMeters: e.distanceMeters,
      lapTime: e.lapTime,
      lapPace: e.lapPace,
      isPr: e.isPr,
      visitCount: e.visitCount,
      historyTimes: Array.from(e.historyTimes),
      historyActivityIds: Array.from(e.historyActivityIds),
    }));
  });
}

export function extractSectionTrace(
  host: DelegateHost,
  activityId: string,
  sectionPolylineJson: string
): FfiGpsPoint[] {
  if (!host.ready) return [];
  validateId(activityId, 'activity ID');
  const flatCoords = host.timed('extractSectionTrace', () =>
    host.engine.sections().extractTrace(activityId, sectionPolylineJson)
  );
  return flatCoordsToPoints(flatCoords);
}

export function extractSectionTracesBatch(
  host: DelegateHost,
  activityIds: string[],
  sectionPolylineJson: string
): Record<string, RoutePoint[]> {
  if (!host.ready || activityIds.length === 0) return {};
  const results = host.timed('extractSectionTracesBatch', () =>
    host.engine.sections().extractTracesBatch(activityIds, sectionPolylineJson)
  );
  const traces: Record<string, RoutePoint[]> = {};
  for (const batch of results) {
    const points: RoutePoint[] = [];
    for (let i = 0; i < batch.coords.length - 1; i += 2) {
      points.push({ lat: batch.coords[i], lng: batch.coords[i + 1] });
    }
    if (points.length > 0) {
      traces[batch.activityId] = points;
    }
  }
  return traces;
}
