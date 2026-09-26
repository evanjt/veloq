/**
 * Preview detection client seam.
 *
 * The Rust SectionPreview object runs a pure detect over one riding area and
 * hands back one record. This module owns the shape the preview screen codes
 * against and the narrowing from the record's open `status` string; the demo
 * fixture implements the same interface.
 */

import { FfiStartOutcome, SectionPreview } from '../generated/veloqrs';
import type {
  FfiPreviewResult,
  FfiPreviewSection,
  FfiSectionConfig,
  SectionPreviewLike,
} from '../generated/veloqrs';
import { toCatalogueCounts } from '../conversions';
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
  /** The place the area covers, joined in the engine, or null when unnamed. */
  locality: string | null;
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
  /** `coords::encode` bytes, ready for `decodeCoords`. */
  polyline: ArrayBuffer;
  visits: number;
  distanceM: number;
  elevationGainM: number | null;
  avgGradePercent: number | null;
  pinned: boolean;
}

/**
 * The engine takes whatever it is given here. The ranges the panel offers, and
 * the points past which the detector stops distinguishing a value, are in
 * `src/features/routes/lib/detectionParams.ts`, which is the one place they
 * are written down: a second copy in this comment went stale by a factor of
 * ten and nothing caught it.
 */
export interface PreviewParams {
  /** Metres. */
  proximityThreshold: number;
  /** Metres. */
  minSectionLength: number;
  /** Metres. */
  maxSectionLength: number;
  minActivities: number;
  /** Worded as route split sensitivity. */
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
 * EngineClient pass-throughs onto the SectionPreview FFI object plus the
 * existing config and redetect methods the Keep path reuses.
 */
export interface PreviewClient {
  /** Listen on one engine channel; the returned function detaches. */
  subscribe(event: string, callback: () => void): () => void;
  getPreviewCentres(limit: number): PreviewCentre[];
  /** Null when the read itself failed, as against an area holding nothing. */
  getPreviewCurrentSections(lat: number, lng: number): PreviewSection[] | null;
  startPreviewDetect(lat: number, lng: number, config: FfiSectionConfig): FfiStartOutcome;
  pollPreviewDetect(): PreviewPollStatus;
  getPreviewProgress(): SectionDetectionProgress | null;
  takePreviewResult(): PreviewResult | null;
  cancelPreviewDetect(): void;
  getSectionConfig(): FfiSectionConfig | null;
  setSectionConfig(config: FfiSectionConfig): void;
  forceRedetectSections(): FfiStartOutcome;
}

const STATUSES: PreviewSectionStatus[] = ['unchanged', 'changed', 'new', 'gone'];

/**
 * Narrow one row of the engine's record.
 *
 * The record carries `status` as an open string, because uniffi has no enum
 * for four words the engine writes and the screen switches on, and the two
 * optional fields arrive as `undefined` where this side reads `null`. Nothing
 * else is converted: the payload used to cross as JSON that this side cast
 * blind, and a field renamed in Rust reached the screen as `undefined`.
 */
export function toPreviewSection(s: FfiPreviewSection): PreviewSection {
  return {
    id: s.id,
    liveId: s.liveId ?? null,
    status: STATUSES.includes(s.status as PreviewSectionStatus)
      ? (s.status as PreviewSectionStatus)
      : 'unchanged',
    name: s.name ?? null,
    sport: s.sport,
    polyline: s.polyline,
    visits: s.visits,
    distanceM: s.distanceM,
    elevationGainM: s.elevationGainM ?? null,
    avgGradePercent: s.avgGradePercent ?? null,
    pinned: s.pinned,
  };
}

/** The run's result, with every section row narrowed. */
export function toPreviewResult(result: FfiPreviewResult): PreviewResult {
  return {
    pool: result.pool,
    elapsedMs: result.elapsedMs,
    config: result.config,
    counts: toCatalogueCounts(result.counts),
    sections: result.sections.map(toPreviewSection),
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
          locality: c.locality ?? null,
        }))
    );
  } catch (e) {
    console.error('[Engine] getPreviewCentres threw:', e);
    return [];
  }
}

/**
 * The live catalogue for the riding area containing (lat, lng). Empty when no
 * activity covers the point, so the screen opens on an empty map rather than a
 * failure. Null when the read failed: a blank map is the same picture either
 * way and the caller has to be able to say which one it is drawing.
 */
export function getPreviewCurrentSections(
  host: DelegateHost,
  lat: number,
  lng: number
): PreviewSection[] | null {
  if (!host.ready) return [];
  try {
    const rows = host.timed('getPreviewCurrentSections', () => previewObj().current(lat, lng));
    return rows ? rows.map(toPreviewSection) : [];
  } catch (e) {
    console.error('[Engine] getPreviewCurrentSections threw:', e);
    return null;
  }
}

/**
 * Start a sandboxed detect over the riding area containing (lat, lng).
 *
 * The refusals are four answers, not one `false`. `Busy` is a run already in
 * flight, `Held` is a backfill holding detection, a real detect running, or
 * the same area backing off after a failed attempt, and all of those end.
 * `NotOwed` is no activity covering the point, which asking again never
 * changes. `NotReady` is the engine not being open yet.
 */
export function startPreviewDetect(
  host: DelegateHost,
  lat: number,
  lng: number,
  config: FfiSectionConfig
): FfiStartOutcome {
  if (!host.ready) return FfiStartOutcome.NotReady;
  try {
    return host.timed('startPreviewDetect', () => previewObj().start(lat, lng, config));
  } catch (e) {
    console.error('[Engine] startPreviewDetect threw:', e);
    return FfiStartOutcome.Failed;
  }
}

export function pollPreviewDetect(host: DelegateHost): PreviewPollStatus {
  if (!host.ready) return 'idle';
  try {
    return host.timed('pollPreviewDetect', () => previewObj().poll()) as PreviewPollStatus;
  } catch (e) {
    console.error('[Engine] pollPreviewDetect threw:', e);
    return 'error';
  }
}

export function getPreviewProgress(host: DelegateHost): SectionDetectionProgress | null {
  if (!host.ready) return null;
  try {
    return host.timed('getPreviewProgress', () => previewObj().getProgress()) ?? null;
  } catch (e) {
    console.error('[Engine] getPreviewProgress threw:', e);
    return null;
  }
}

/** Take the one result payload. Null while running or after taken. */
export function takePreviewResult(host: DelegateHost): PreviewResult | null {
  if (!host.ready) return null;
  try {
    const result = host.timed('takePreviewResult', () => previewObj().takeResult());
    return result ? toPreviewResult(result) : null;
  } catch (e) {
    console.error('[Engine] takePreviewResult threw:', e);
    return null;
  }
}

/**
 * Guarded, not written: a cancel held from before the engine opened refers to
 * a preview that never started, and replaying it would cancel a live one.
 */
export function cancelPreviewDetect(host: DelegateHost): void {
  if (!host.ready) return;
  try {
    host.timed('cancelPreviewDetect', () => previewObj().cancel());
  } catch (e) {
    console.error('[Engine] cancelPreviewDetect threw:', e);
  }
}
