/**
 * Section query delegates (read-only).
 *
 * Pure read operations over sections: CRUD list/get, polylines, performances,
 * efficiency trends, calendar summaries, reference info, nearby/merge
 * candidates, matching queries, indicators, encounters, and trace extraction.
 * No mutations emitted from this module.
 */

import { validateId } from '../../conversions';
import type {
  FfiEfficiencyTrend,
  FfiSection,
  FfiMapSection,
  FfiNamedCorridor,
  FfiRankedSection,
  FfiSectionDetailData,
  FfiSectionPerformanceData,
  FfiSectionPerformanceResult,
  FfiWorkoutSection,
  SectionSummary,
  FfiSectionChartData,
} from '../../generated/veloqrs';
import type { DelegateHost } from '../host';
import { present } from '../optional';
import type { FfiSectionMatch } from '../shared-types';

const EMPTY_SECTION_PERFORMANCE_RESULT: FfiSectionPerformanceResult = {
  records: [],
  bestForwardIsPr: false,
  bestReverseIsPr: false,
};

/**
 * Sections as the regional map draws them: six fields and the encoded line.
 *
 * The full section record carries the activity ids, one portion record per
 * traversal and the point density per section, and the map reads none of it.
 */
export function getMapSections(
  host: DelegateHost,
  sportType?: string,
  minVisits?: number
): FfiMapSection[] {
  if (!host.ready) return [];
  // FfiConverterOptional* accepts undefined for "absent" but throws on null -
  // forward optional args as-is, do NOT coalesce to null.
  return host.timed('getMapSections', () =>
    host.engine.sections().getMapSections(sportType, minVisits)
  );
}

export function getSectionsForActivity(host: DelegateHost, activityId: string): FfiSection[] {
  if (!host.ready) return [];
  return host.timed('getSectionsForActivity', () =>
    host.engine.sections().getSections({ activityId })
  );
}

/**
 * Total section count without deserializing section blobs. Cheap alternative
 * to `getSectionSummaries().totalCount` for callers
 * that only need to test emptiness or show a count. Backed by
 * `SectionManager.get_count`.
 */
export function getSectionCount(host: DelegateHost): number {
  if (!host.ready) return 0;
  return host.timed('getSectionCount', () => host.engine.sections().getCount());
}

export function getSectionSummaries(
  host: DelegateHost,
  sportType?: string
): { totalCount: number; summaries: SectionSummary[] } {
  if (!host.ready) return { totalCount: 0, summaries: [] };
  return host.timed('getSectionSummaries', () =>
    host.engine.sections().getSummaries(present({ sportType }), undefined)
  );
}

/**
 * Every named corridor with its current resolution, dormant ones included
 * (sectionId is undefined while no visible section covers the named ground).
 */
export function getNamedCorridors(host: DelegateHost): FfiNamedCorridor[] {
  if (!host.ready) return [];
  return host.timed('getNamedCorridors', () => host.engine.sections().getNamedCorridors());
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
    host.engine.sections().getSummaries(present({ sportType, minVisits }), sortKey)
  );
}

export interface RankedSectionsBySport {
  sportType: string;
  sections: FfiRankedSection[];
}

export function getSectionById(host: DelegateHost, sectionId: string): FfiSection | null {
  if (!host.ready) return null;
  validateId(sectionId, 'section ID');
  return host.timed('getSectionById', () => host.engine.sections().getById(sectionId)) ?? null;
}

export function getAllSectionNames(host: DelegateHost): Record<string, string> {
  if (!host.ready) return {};
  const map = host.timed('getAllSectionNames', () => host.engine.sections().getAllNames());
  return Object.fromEntries(map);
}

export function getSectionsByType(
  host: DelegateHost,
  sectionType?: 'auto' | 'custom'
): FfiSection[] {
  if (!host.ready) return [];
  return host.timed('getSectionsByType', () =>
    host.engine.sections().getSections(present({ sectionType }))
  );
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
): { sectionId: string; result: FfiSectionPerformanceResult }[] {
  if (!host.ready || sectionIds.length === 0) return [];
  return host.timed('getPerformancesBatch', () =>
    host.engine.sections().getPerformancesBatch(sectionIds, sportType)
  );
}

export type { FfiWorkoutSection } from '../../generated/veloqrs';

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
export type { FfiSectionChartData };
export type { FfiSectionChartPoint } from '../../generated/veloqrs';

export function getSectionEfficiencyTrend(
  host: DelegateHost,
  sectionId: string,
  sportType: string
): FfiEfficiencyTrend | null {
  if (!host.ready) {
    return null;
  }
  return host.timed(
    'getSectionEfficiencyTrend',
    () => host.engine.sections().getEfficiencyTrend(sectionId, sportType) ?? null
  );
}

export function getSectionReferenceInfo(
  host: DelegateHost,
  sectionId: string
): { activityId?: string; isUserDefined: boolean } {
  if (!host.ready) return { isUserDefined: false };
  validateId(sectionId, 'section ID');
  const info = host.timed('getSectionReferenceInfo', () =>
    host.engine.sections().getReferenceInfo(sectionId)
  );
  return present({ activityId: info?.activityId, isUserDefined: info?.isUserDefined ?? false });
}

/**
 * Get the representative activity's full GPS track for section expansion.
 * Returns the track as delta+varint encoded coords + section start/end indices.
 */
export function getSectionExtensionTrack(
  host: DelegateHost,
  sectionId: string
): { encodedTrack: ArrayBuffer; sectionStartIdx: number; sectionEndIdx: number } | null {
  if (!host.ready) return null;
  validateId(sectionId, 'section ID');
  return host.timed('getSectionExtensionTrack', () => {
    const result = host.engine.sections().getExtensionTrack(sectionId);
    return {
      encodedTrack: result.encodedTrack,
      sectionStartIdx: result.sectionStartIdx,
      sectionEndIdx: result.sectionEndIdx,
    };
  });
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

/**
 * The section detail reads that do not depend on time streams: the section,
 * its merge candidates, exclusions, bounds state, per-activity
 * metrics and signatures, and the streams still to be fetched.
 */
export function getSectionDetailData(
  host: DelegateHost,
  sectionId: string
): FfiSectionDetailData | undefined {
  if (!host.ready || !sectionId) return undefined;
  return host.timed('getSectionDetailData', () => host.engine.sections().getDetailData(sectionId));
}

/**
 * The section detail reads that need lap times. Call once the streams named
 * by `getSectionDetailData` have landed.
 */
export function getSectionDetailPerformance(
  host: DelegateHost,
  sectionId: string,
  timeRangeDays: number,
  sportFilter?: string
): FfiSectionPerformanceData | undefined {
  if (!host.ready || !sectionId) return undefined;
  return host.timed('getSectionDetailPerformance', () =>
    host.engine.sections().getDetailPerformance(sectionId, timeRangeDays, sportFilter)
  );
}
