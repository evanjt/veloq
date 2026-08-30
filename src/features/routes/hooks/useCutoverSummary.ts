/**
 * Reads the detector cutover's state for the change card.
 *
 * The cutover runs on its own in Rust, so this hook only observes: it never
 * starts a run. Counts are withheld while a run is in flight, because the
 * stored diff still describes the previous one and would misreport the
 * catalogue the user is watching being rebuilt.
 */

import { useEffect, useRef, useState } from 'react';

import { getRouteEngine } from '@/shared/native/routeEngine';
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
}

const IDLE: CutoverSummary = { phase: 'idle', isRunning: false, counts: null };

/** An unrecognised phase reads as idle rather than as a finished run. */
function narrowPhase(phase: string): CutoverPhase {
  return PHASES.includes(phase as CutoverPhase) ? (phase as CutoverPhase) : 'idle';
}

function read(): CutoverSummary {
  const engine = getRouteEngine();
  if (!engine) return IDLE;
  try {
    const progress = engine.getCutoverProgress?.();
    if (!progress) return IDLE;
    const phase = narrowPhase(progress.phase);
    if (progress.running) return { phase, isRunning: true, counts: null };
    return { phase, isRunning: false, counts: engine.getCutoverDiff?.()?.counts ?? null };
  } catch {
    return IDLE;
  }
}

function same(a: CutoverSummary, b: CutoverSummary): boolean {
  return (
    a.phase === b.phase &&
    a.isRunning === b.isRunning &&
    a.counts?.current === b.counts?.current &&
    a.counts?.proposed === b.counts?.proposed &&
    a.counts?.unchanged === b.counts?.unchanged &&
    a.counts?.changed === b.counts?.changed &&
    a.counts?.new === b.counts?.new &&
    a.counts?.gone === b.counts?.gone
  );
}

export function useCutoverSummary(): CutoverSummary {
  const [state, setState] = useState<CutoverSummary>(read);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const tick = () => {
      const next = read();
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
