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
  cancelDetectorCutover as ffiCancelDetectorCutover,
  startDetectorCutover as ffiStartDetectorCutover,
  getCutoverProgress as ffiGetCutoverProgress,
  getCutoverDiff as ffiGetCutoverDiff,
  getChangeCardSupport as ffiGetChangeCardSupport,
} from '../generated/veloqrs';
import type { FfiChangeCardSupport } from '../generated/veloqrs';
import { toCatalogueCounts } from '../conversions';
import type { DelegateHost } from './host';

export interface CutoverCounts {
  current: number;
  proposed: number;
  unchanged: number;
  changed: number;
  new: number;
  gone: number;
}

/** The five detector values the flip resets to the validated configuration. */
export interface CutoverSettings {
  proximityThreshold: number;
  minSectionLength: number;
  maxSectionLength: number;
  minActivities: number;
  divergenceThreshold: number;
}

/** What the flip replaced beside what it wrote. Absent when nothing moved. */
export interface CutoverSettingsReset {
  previous: CutoverSettings;
  current: CutoverSettings;
}

/**
 * What the change card reads. Counts and the reset only: a section is a
 * reference activity and the indices of a pass over it, so a row per section
 * put both catalogues' geometry in a settings row for the life of the
 * install. An older payload still carries those rows and is read past, not
 * rejected.
 */
export interface CutoverDiff {
  token: string;
  counts: CutoverCounts;
  settingsReset: CutoverSettingsReset | null;
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

/**
 * Ask the running cutover to stop at its next step boundary.
 *
 * Costs the run's work and nothing else: the migration is still owed and the
 * next launch runs it again from the top. Safe with nothing running, and safe
 * before the engine is ready, where there is nothing to stop.
 */
export function cancelDetectorCutover(host: DelegateHost): void {
  if (!host.ready) return;
  try {
    host.timed('cancelDetectorCutover', () => ffiCancelDetectorCutover());
  } catch (e) {
    console.error('[Engine] cancelDetectorCutover threw:', e);
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

/**
 * The stored diff, so the change card survives a restart.
 *
 * The engine parses the settings row it persisted and hands back a record: the
 * payload used to cross as a JSON string this side cast blind, so a field
 * renamed in Rust reached the card as `undefined`. What is left here
 * is `undefined` becoming `null`, which is the only difference between the
 * record and the shape the card reads.
 */
export function getCutoverDiff(host: DelegateHost): CutoverDiff | null {
  if (!host.ready) return null;
  try {
    const diff = host.timed('getCutoverDiff', () => ffiGetCutoverDiff());
    if (!diff) return null;
    return {
      token: diff.token,
      counts: toCatalogueCounts(diff.counts),
      settingsReset: diff.settingsReset ?? null,
    };
  } catch (e) {
    console.error('[Engine] getCutoverDiff threw:', e);
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
