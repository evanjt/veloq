/**
 * Detector cutover delegates.
 *
 * The cutover migrates an existing install from Corridor to Unified: archive
 * the current catalogue, switch the persisted config, re-cut once, then show
 * the user what changed with a revert. All calls are standalone UniFFI
 * exports rather than engine methods, so they read from the generated module.
 */

import {
  isCutoverPending as ffiIsCutoverPending,
  isCutoverRunning as ffiIsCutoverRunning,
  runDetectorCutover as ffiRunDetectorCutover,
  restoreFromCutoverArchive as ffiRestoreFromCutoverArchive,
  getCutoverDiff as ffiGetCutoverDiff,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';

/** One section's fate across the cutover. */
export interface CutoverSection {
  id: string;
  liveId: string | null;
  status: 'unchanged' | 'changed' | 'new' | 'gone';
  name: string | null;
  sport: string;
  polylineBase64: string;
  visits: number;
  distanceM: number;
  elevationGainM: number | null;
  avgGradePercent: number | null;
}

export interface CutoverCounts {
  current: number;
  proposed: number;
  unchanged: number;
  changed: number;
  new: number;
  gone: number;
}

export interface CutoverDiff {
  token: string;
  counts: CutoverCounts;
  sections: CutoverSection[];
}

/**
 * Whether the migration is still owed. False once it has run, and false for a
 * user who reverted, so it is safe to check on every launch.
 * An engine that is not ready answers false, never true: a cutover must never
 * be started off a half-open engine.
 */
export function isCutoverPending(host: DelegateHost): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('isCutoverPending', () => ffiIsCutoverPending());
  } catch (e) {
    console.error('[RouteEngine] isCutoverPending threw:', e);
    return false;
  }
}

/** Whether a cutover run is in flight. */
export function isCutoverRunning(host: DelegateHost): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('isCutoverRunning', () => ffiIsCutoverRunning());
  } catch (e) {
    console.error('[RouteEngine] isCutoverRunning threw:', e);
    return false;
  }
}

/**
 * Run the whole cutover. Blocking: the caller owns putting it on a worker.
 * Returns the diff payload on success, null on any failure, leaving the user
 * on Corridor with an intact catalogue.
 */
export function runDetectorCutover(host: DelegateHost): CutoverDiff | null {
  if (!host.ready) return null;
  try {
    const json = host.timed('runDetectorCutover', () => ffiRunDetectorCutover());
    return parseCutoverDiff(json);
  } catch (e) {
    console.error('[RouteEngine] runDetectorCutover threw:', e);
    return null;
  }
}

/**
 * Put the archived catalogue back as pinned sections and return the config to
 * Corridor. Returns how many sections were restored, which is legitimately
 * zero for a catalogue that was entirely pinned already, or null when the
 * restore failed. The caller must tell those apart: zero means the revert
 * happened and had nothing to move, null means the user is still on Unified.
 */
export function restoreFromCutoverArchive(host: DelegateHost): number | null {
  if (!host.ready) return null;
  try {
    return host.timed('restoreFromCutoverArchive', () => ffiRestoreFromCutoverArchive());
  } catch (e) {
    console.error('[RouteEngine] restoreFromCutoverArchive threw:', e);
    return null;
  }
}

/** The stored diff, so the change card survives a restart. */
export function getCutoverDiff(host: DelegateHost): CutoverDiff | null {
  if (!host.ready) return null;
  try {
    const json = host.timed('getCutoverDiff', () => ffiGetCutoverDiff());
    return json ? parseCutoverDiff(json) : null;
  } catch (e) {
    console.error('[RouteEngine] getCutoverDiff threw:', e);
    return null;
  }
}

/** Parse the Rust payload. Returns null on anything malformed. */
export function parseCutoverDiff(json: string): CutoverDiff | null {
  try {
    const raw = JSON.parse(json) as {
      token?: unknown;
      counts?: Record<string, unknown>;
      sections?: unknown[];
    };
    if (typeof raw.token !== 'string' || !raw.counts || !Array.isArray(raw.sections)) {
      return null;
    }
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const counts: CutoverCounts = {
      current: num(raw.counts.current),
      proposed: num(raw.counts.proposed),
      unchanged: num(raw.counts.unchanged),
      changed: num(raw.counts.changed),
      new: num(raw.counts.new),
      gone: num(raw.counts.gone),
    };
    const sections: CutoverSection[] = [];
    for (const entry of raw.sections) {
      const s = entry as Record<string, unknown>;
      const status = s.status;
      if (
        typeof s.id !== 'string' ||
        (status !== 'unchanged' && status !== 'changed' && status !== 'new' && status !== 'gone')
      ) {
        continue;
      }
      sections.push({
        id: s.id,
        liveId: typeof s.live_id === 'string' ? s.live_id : null,
        status,
        name: typeof s.name === 'string' ? s.name : null,
        sport: typeof s.sport === 'string' ? s.sport : '',
        polylineBase64: typeof s.polyline === 'string' ? s.polyline : '',
        visits: num(s.visits),
        distanceM: num(s.distance_m),
        elevationGainM: typeof s.elevation_gain_m === 'number' ? s.elevation_gain_m : null,
        avgGradePercent: typeof s.avg_grade_percent === 'number' ? s.avg_grade_percent : null,
      });
    }
    return { token: raw.token, counts, sections };
  } catch {
    return null;
  }
}
