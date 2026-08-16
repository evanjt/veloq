/**
 * Reads the elevation backfill's progress for the Settings status line.
 *
 * The backfill runs on its own in Rust, so this hook only observes: it never
 * starts a run. Polls while mounted, at the same cadence as the section rescan.
 */

import { useEffect, useRef, useState } from 'react';

import { getRouteEngine } from '@/shared/native/routeEngine';
import type { ElevationBackfillPhase } from 'veloqrs';

const POLL_INTERVAL_MS = 500;

const PHASES: ElevationBackfillPhase[] = ['idle', 'fetching', 'complete', 'partial', 'failed'];

export interface ElevationBackfillState {
  /** idle, fetching, or one of the three terminal states. */
  phase: ElevationBackfillPhase;
  /** Activities the current or last run has finished with. */
  completed: number;
  /** Activities the current or last run started with. */
  total: number;
  /** Activities whose fetch failed, so a later run retries them. */
  failed: number;
  isRunning: boolean;
}

const IDLE: ElevationBackfillState = {
  phase: 'idle',
  completed: 0,
  total: 0,
  failed: 0,
  isRunning: false,
};

/** An unrecognised phase reads as idle rather than as a finished run. */
function narrowPhase(phase: string): ElevationBackfillPhase {
  return PHASES.includes(phase as ElevationBackfillPhase)
    ? (phase as ElevationBackfillPhase)
    : 'idle';
}

function read(): ElevationBackfillState {
  const engine = getRouteEngine();
  if (!engine) return IDLE;
  const progress = engine.getElevationBackfillProgress();
  if (!progress) return IDLE;
  const phase = narrowPhase(progress.phase);
  return {
    phase,
    completed: progress.completed,
    total: progress.total,
    failed: progress.failed,
    isRunning: phase === 'fetching',
  };
}

function same(a: ElevationBackfillState, b: ElevationBackfillState): boolean {
  return (
    a.phase === b.phase &&
    a.completed === b.completed &&
    a.total === b.total &&
    a.failed === b.failed
  );
}

export function useElevationBackfill(): ElevationBackfillState {
  const [state, setState] = useState<ElevationBackfillState>(read);
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
