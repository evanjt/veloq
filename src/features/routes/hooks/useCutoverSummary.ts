/**
 * Reads the detector cutover's state for the change card.
 *
 * The cutover runs on its own in Rust, so this hook only observes: it never
 * starts a run. Counts are withheld while a run is in flight, because the
 * stored diff still describes the previous one and would misreport the
 * catalogue the user is watching being rebuilt.
 */

import { useEffect, useState } from 'react';

import { getEngine } from '@/shared/native/engine';
import type { CutoverCounts, CutoverPhase, CutoverSettingsReset } from 'veloqrs';

/** Rust announces the commit here, and the diff is read on that alone. */
const CHANNEL = 'cutoverSettled';

/**
 * The phases inside a run carry no event, so a run in flight is followed on a
 * timer. Nothing in flight means nothing to follow and no call is made.
 */
const PHASE_POLL_MS = 500;

const PHASES: CutoverPhase[] = [
  'idle',
  'draining',
  'archiving',
  'detecting',
  'diffing',
  'complete',
  'failed',
];

export interface CutoverSummary {
  phase: CutoverPhase;
  isRunning: boolean;
  /** The stored diff's counts, or null while a run is in flight. */
  counts: CutoverCounts | null;
  /** The settings the flip reset, read with the counts and withheld with them. */
  settingsReset: CutoverSettingsReset | null;
  /**
   * Whether this observer saw a run take the slot. A settled phase left over
   * from a run that finished before the caller mounted is not news, so a
   * surface that only reports live work reads this rather than the phase.
   */
  sawRun: boolean;
}

const IDLE: CutoverSummary = {
  phase: 'idle',
  isRunning: false,
  counts: null,
  settingsReset: null,
  sawRun: false,
};

/** An unrecognised phase reads as idle rather than as a finished run. */
function narrowPhase(phase: string): CutoverPhase {
  return PHASES.includes(phase as CutoverPhase) ? (phase as CutoverPhase) : 'idle';
}

/**
 * A full snapshot: the phase, and the stored diff once the slot is free.
 * Parsing the diff walks every section, so this runs at mount and on the
 * settle only.
 */
function read(sawRun: boolean): CutoverSummary {
  const engine = getEngine();
  if (!engine) return { ...IDLE, sawRun };
  try {
    const progress = engine.getCutoverProgress?.();
    if (!progress) return { ...IDLE, sawRun };
    const phase = narrowPhase(progress.phase);
    if (progress.running) {
      return { phase, isRunning: true, counts: null, settingsReset: null, sawRun: true };
    }
    const diff = engine.getCutoverDiff?.();
    return {
      phase,
      isRunning: false,
      counts: diff?.counts ?? null,
      settingsReset: diff?.settingsReset ?? null,
      sawRun,
    };
  } catch {
    return { ...IDLE, sawRun };
  }
}

/**
 * The phase alone, carrying the counts through untouched. Returns the same
 * object when nothing moved, so a run that sits in one phase re-renders
 * nothing.
 */
function phaseOnly(previous: CutoverSummary): CutoverSummary {
  const engine = getEngine();
  if (!engine) return previous;
  try {
    const progress = engine.getCutoverProgress?.();
    if (!progress) return previous;
    const phase = narrowPhase(progress.phase);
    if (phase === previous.phase && progress.running === previous.isRunning) return previous;
    return {
      phase,
      isRunning: progress.running,
      counts: progress.running ? null : previous.counts,
      settingsReset: progress.running ? null : previous.settingsReset,
      sawRun: previous.sawRun,
    };
  } catch {
    return previous;
  }
}

export function useCutoverSummary(): CutoverSummary {
  const [state, setState] = useState<CutoverSummary>(() => read(false));

  useEffect(() => {
    // The event fires only for a run that reached a terminal phase, so hearing
    // it is itself proof of a run, including one that started before the mount.
    const off = getEngine()?.subscribe?.(CHANNEL, () => setState(read(true)));
    return () => off?.();
  }, []);

  const running = state.isRunning;
  useEffect(() => {
    const timer = running ? setInterval(() => setState(phaseOnly), PHASE_POLL_MS) : undefined;
    return () => clearInterval(timer);
  }, [running]);

  return state;
}
