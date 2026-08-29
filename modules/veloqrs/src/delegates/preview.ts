/**
 * Preview detection client seam.
 *
 * The Rust SectionPreview object runs a pure detect over one riding area and
 * hands back a single snake_case JSON payload. This module owns the camelCase
 * shape of that payload and the client interface the preview screen codes
 * against. The engine-backed implementation lands with the facade wiring; the
 * demo fixture implements the same interface until then.
 */

import { SectionPreview } from '../generated/veloqrs';
import type { FfiSectionConfig, SectionPreviewLike } from '../generated/veloqrs';
import type { SectionDetectionProgress } from '../conversions';
import type { DelegateHost } from './host';

export interface PreviewCentre {
  /** "lat_bin:lng_bin" at ~5 km, an order-free ranking key. */
  binKey: string;
  lat: number;
  lng: number;
  visitTotal: number;
  sectionCount: number;
  source: 'sections' | 'activities';
}

export type PreviewSectionStatus = 'unchanged' | 'changed' | 'new' | 'gone';

export interface PreviewSection {
  /** Proposed id; for "gone" rows the live id. */
  id: string;
  liveId: string | null;
  status: PreviewSectionStatus;
  /** Live user name when matched. */
  name: string | null;
  sport: string;
  /** Base64 of coords::encode bytes; decode via atob then decodeCoords. */
  polylineBase64: string;
  visits: number;
  distanceM: number;
  elevationGainM: number | null;
  avgGradePercent: number | null;
  pinned: boolean;
}

export interface PreviewParams {
  /** Metres, 25-300 step 25. */
  proximityThreshold: number;
  /** Metres, 50-2000 step 50. */
  minSectionLength: number;
  /** Metres, 2000-20000 step 1000. */
  maxSectionLength: number;
  /** 2-10 step 1. */
  minActivities: number;
  /** 0.05-0.5 step 0.05, worded as route split sensitivity. */
  divergenceThreshold: number;
}

export interface PreviewResult {
  pool: { activities: number; empty: number; unreadable: number };
  elapsedMs: number;
  config: PreviewParams;
  counts: {
    current: number;
    proposed: number;
    unchanged: number;
    changed: number;
    new: number;
    gone: number;
  };
  sections: PreviewSection[];
}

export type PreviewPollStatus =
  | 'idle'
  | 'running'
  | 'complete'
  | 'cancelled'
  | 'error'
  | 'pool_unusable';

/**
 * The surface the preview screen talks to. The real implementation is
 * RouteEngineClient pass-throughs onto the SectionPreview FFI object plus the
 * existing config and redetect methods the Keep path reuses.
 */
export interface PreviewClient {
  getPreviewCentres(limit: number): PreviewCentre[];
  startPreviewDetect(lat: number, lng: number, config: FfiSectionConfig): boolean;
  pollPreviewDetect(): PreviewPollStatus;
  getPreviewProgress(): SectionDetectionProgress | null;
  takePreviewResult(): PreviewResult | null;
  cancelPreviewDetect(): void;
  getSectionConfig(): FfiSectionConfig | null;
  setSectionConfig(config: FfiSectionConfig): void;
  forceRedetectSections(): boolean;
}

interface RawPreviewSection {
  id: string;
  live_id: string | null;
  status: PreviewSectionStatus;
  name: string | null;
  sport: string;
  polyline: string;
  visits: number;
  distance_m: number;
  elevation_gain_m: number | null;
  avg_grade_percent: number | null;
  pinned: boolean;
}

interface RawPreviewResult {
  pool: { activities: number; empty: number; unreadable: number };
  elapsed_ms: number;
  config: {
    proximity_threshold: number;
    min_section_length: number;
    max_section_length: number;
    min_activities: number;
    divergence_threshold: number;
  };
  counts: {
    current: number;
    proposed: number;
    unchanged: number;
    changed: number;
    new: number;
    gone: number;
  };
  sections: RawPreviewSection[];
}

/** Map the engine's snake_case JSON payload to the camelCase result. */
export function parsePreviewResult(json: string): PreviewResult | null {
  let raw: RawPreviewResult;
  try {
    raw = JSON.parse(json) as RawPreviewResult;
  } catch {
    return null;
  }
  if (!raw || !Array.isArray(raw.sections)) return null;
  return {
    pool: raw.pool,
    elapsedMs: raw.elapsed_ms,
    config: {
      proximityThreshold: raw.config.proximity_threshold,
      minSectionLength: raw.config.min_section_length,
      maxSectionLength: raw.config.max_section_length,
      minActivities: raw.config.min_activities,
      divergenceThreshold: raw.config.divergence_threshold,
    },
    counts: raw.counts,
    sections: raw.sections.map((s) => ({
      id: s.id,
      liveId: s.live_id,
      status: s.status,
      name: s.name,
      sport: s.sport,
      polylineBase64: s.polyline,
      visits: s.visits,
      distanceM: s.distance_m,
      elevationGainM: s.elevation_gain_m,
      avgGradePercent: s.avg_grade_percent,
      pinned: s.pinned,
    })),
  };
}

let previewObject: SectionPreviewLike | null = null;

/** One SectionPreview handle per JS runtime; the Rust side is a thin facade. */
function previewObj(): SectionPreviewLike {
  if (!previewObject) previewObject = new SectionPreview();
  return previewObject;
}

/** Ranked riding areas, ordered visit total descending. */
export function getPreviewCentres(host: DelegateHost, limit: number): PreviewCentre[] {
  if (!host.ready) return [];
  try {
    return host.timed('getPreviewCentres', () =>
      previewObj()
        .centres(limit)
        .map((c) => ({
          binKey: c.binKey,
          lat: c.lat,
          lng: c.lng,
          visitTotal: c.visitTotal,
          sectionCount: c.sectionCount,
          source: c.source === 'sections' ? ('sections' as const) : ('activities' as const),
        }))
    );
  } catch (e) {
    console.error('[RouteEngine] getPreviewCentres threw:', e);
    return [];
  }
}

/**
 * Start a sandboxed detect over the riding area containing (lat, lng). False
 * when a preview or real detect is running, or detection is suspended for the
 * elevation backfill.
 */
export function startPreviewDetect(
  host: DelegateHost,
  lat: number,
  lng: number,
  config: FfiSectionConfig
): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('startPreviewDetect', () => previewObj().start(lat, lng, config));
  } catch (e) {
    console.error('[RouteEngine] startPreviewDetect threw:', e);
    return false;
  }
}

export function pollPreviewDetect(host: DelegateHost): PreviewPollStatus {
  if (!host.ready) return 'idle';
  try {
    return host.timed('pollPreviewDetect', () => previewObj().poll()) as PreviewPollStatus;
  } catch (e) {
    console.error('[RouteEngine] pollPreviewDetect threw:', e);
    return 'error';
  }
}

export function getPreviewProgress(host: DelegateHost): SectionDetectionProgress | null {
  if (!host.ready) return null;
  try {
    return host.timed('getPreviewProgress', () => previewObj().getProgress()) ?? null;
  } catch (e) {
    console.error('[RouteEngine] getPreviewProgress threw:', e);
    return null;
  }
}

/** Take the one result payload. Null while running or after taken. */
export function takePreviewResult(host: DelegateHost): PreviewResult | null {
  if (!host.ready) return null;
  try {
    const json = host.timed('takePreviewResult', () => previewObj().takeResult());
    return json ? parsePreviewResult(json) : null;
  } catch (e) {
    console.error('[RouteEngine] takePreviewResult threw:', e);
    return null;
  }
}

export function cancelPreviewDetect(host: DelegateHost): void {
  if (!host.ready) return;
  try {
    host.timed('cancelPreviewDetect', () => previewObj().cancel());
  } catch (e) {
    console.error('[RouteEngine] cancelPreviewDetect threw:', e);
  }
}
