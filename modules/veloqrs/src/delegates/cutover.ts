/**
 * Detector cutover delegates.
 *
 * The cutover re-cuts a catalogue an older build produced: archive the
 * current catalogue, re-cut once, then show the user what changed. All calls are standalone UniFFI
 * exports rather than engine methods, so they read from the generated module.
 */

import {
  isCutoverPending as ffiIsCutoverPending,
  isCutoverRunning as ffiIsCutoverRunning,
  startDetectorCutover as ffiStartDetectorCutover,
  getCutoverProgress as ffiGetCutoverProgress,
  getCutoverDiff as ffiGetCutoverDiff,
  getChangeCardSupport as ffiGetChangeCardSupport,
} from '../generated/veloqrs';
import type { FfiChangeCardSupport } from '../generated/veloqrs';
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
    console.error('[Engine] isCutoverPending threw:', e);
    return false;
  }
}

/** Whether a cutover run is in flight. */
export function isCutoverRunning(host: DelegateHost): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('isCutoverRunning', () => ffiIsCutoverRunning());
  } catch (e) {
    console.error('[Engine] isCutoverRunning threw:', e);
    return false;
  }
}

/** How far a running cutover has got. */
export type CutoverPhase =
  | 'idle'
  | 'draining'
  | 'archiving'
  | 'detecting'
  | 'diffing'
  | 'complete'
  | 'failed';

export interface CutoverProgress {
  phase: CutoverPhase;
  running: boolean;
}

const CUTOVER_PHASES: readonly string[] = [
  'idle',
  'draining',
  'archiving',
  'detecting',
  'diffing',
  'complete',
  'failed',
];

/**
 * Start the cutover on a Rust worker. Returns whether a run began: false means
 * the engine is not ready, the migration is not owed, or one is already in
 * flight. Safe to call at every launch.
 */
export function startDetectorCutover(host: DelegateHost): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('startDetectorCutover', () => ffiStartDetectorCutover());
  } catch (e) {
    console.error('[Engine] startDetectorCutover threw:', e);
    return false;
  }
}

/** Poll the running cutover. An unknown phase reads as idle. */
export function getCutoverProgress(host: DelegateHost): CutoverProgress | null {
  if (!host.ready) return null;
  try {
    const p = host.timed('getCutoverProgress', () => ffiGetCutoverProgress());
    const phase = CUTOVER_PHASES.includes(p.phase) ? (p.phase as CutoverPhase) : 'idle';
    return { phase, running: p.running };
  } catch (e) {
    console.error('[Engine] getCutoverProgress threw:', e);
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
    console.error('[Engine] getCutoverDiff threw:', e);
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

export type ChangeCardSupport = FfiChangeCardSupport;

const NO_SUPPORT: ChangeCardSupport = {
  deterministic: false,
  sameResultDripOrBatch: false,
  ledger: false,
  revert: false,
  retired: false,
  pinnedSurvive: false,
  sameOnEveryDevice: false,
};

/**
 * Which claims the change card may make on this build. Every flag is false
 * off a half-open engine, so the card shows nothing rather than a guess.
 */
export function getChangeCardSupport(host: DelegateHost): ChangeCardSupport {
  if (!host.ready) return NO_SUPPORT;
  try {
    return ffiGetChangeCardSupport();
  } catch (e) {
    console.error('[Engine] getChangeCardSupport threw:', e);
    return NO_SUPPORT;
  }
}
