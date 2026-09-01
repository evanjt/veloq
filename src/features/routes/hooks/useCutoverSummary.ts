/**
 * Reads the detector cutover's state for the change card.
 *
 * The cutover runs on its own in Rust, so this hook only observes: it never
 * starts a run. Counts are withheld while a run is in flight, because the
 * stored diff still describes the previous one and would misreport the
 * catalogue the user is watching being rebuilt.
 */

import { useEffect, useRef, useState } from 'react';

import { getEngine } from '@/shared/native/engine';
import type { CutoverCounts, CutoverPhase } from 'veloqrs';

const POLL_INTERVAL_MS = 500;

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
  /**
   * Whether this observer saw a run take the slot. A settled phase left over
   * from a run that finished before the caller mounted is not news, so a
   * surface that only reports live work reads this rather than the phase.
   */
  sawRun: boolean;
}

const IDLE: CutoverSummary = { phase: 'idle', isRunning: false, counts: null, sawRun: false };

/** An unrecognised phase reads as idle rather than as a finished run. */
function narrowPhase(phase: string): CutoverPhase {
  return PHASES.includes(phase as CutoverPhase) ? (phase as CutoverPhase) : 'idle';
}

/**
 * `needDiff` is what keeps the parser off the poll. Parsing walks every section,
 * and a settled diff does not change until the next run, so it is read once per
 * settle and carried after that. The caller re-arms it when a run takes the slot.
 */
function read(previous: CutoverSummary, needDiff: boolean): CutoverSummary {
  const engine = getEngine();
  const sawRun = previous.sawRun;
  if (!engine) return { ...IDLE, sawRun };
  try {
    const progress = engine.getCutoverProgress?.();
    if (!progress) return { ...IDLE, sawRun };
    const phase = narrowPhase(progress.phase);
    if (progress.running) return { phase, isRunning: true, counts: null, sawRun: true };
    if (!needDiff) return { phase, isRunning: false, counts: previous.counts, sawRun };
    return {
      phase,
      isRunning: false,
      counts: engine.getCutoverDiff?.()?.counts ?? null,
      sawRun,
    };
  } catch {
    return { ...IDLE, sawRun };
  }
}

function same(a: CutoverSummary, b: CutoverSummary): boolean {
  return (
    a.phase === b.phase &&
    a.isRunning === b.isRunning &&
    a.sawRun === b.sawRun &&
    a.counts?.current === b.counts?.current &&
    a.counts?.proposed === b.counts?.proposed &&
    a.counts?.unchanged === b.counts?.unchanged &&
    a.counts?.changed === b.counts?.changed &&
    a.counts?.new === b.counts?.new &&
    a.counts?.gone === b.counts?.gone
  );
}

export function useCutoverSummary(): CutoverSummary {
  const [state, setState] = useState<CutoverSummary>(() => read(IDLE, true));
  const stateRef = useRef(state);
  stateRef.current = state;
  const needDiffRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const next = read(stateRef.current, needDiffRef.current);
      // Arm the next settle's read while the run still holds the slot, so the
      // numbers it produces are picked up on the edge and only then.
      needDiffRef.current = next.isRunning;
      if (!same(stateRef.current, next)) {
        stateRef.current = next;
        setState(next);
      }
    };
    tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return state;
}
