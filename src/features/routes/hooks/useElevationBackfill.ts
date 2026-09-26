/**
 * Reads the elevation backfill's progress for the Settings status line.
 *
 * The backfill runs on its own in Rust, so this hook only observes: it never
 * starts a run. Rust announces each phase it enters, so an idle library costs
 * one read at mount and nothing after it. The count inside a run has no event
 * of its own, so a live run is polled and only a live run is.
 *
 * The phase is a process-global that starts at `idle` and only a pass moves,
 * so it cannot answer at rest and every launch without one read as nothing
 *. At rest the answer comes from `getElevationBackfillRemaining`, a
 * count of stored tracks that have not been asked about yet, which is durable.
 */

import { useEffect, useRef, useState } from 'react';

import { getEngine } from '@/shared/native/engine';
import type { ElevationBackfillPhase, RoutesStatus } from 'veloqrs';

import { followRoutesStatus, readRoutesStatus } from '@/shared/native/routesStatusPoll';

/** The channel `EngineObserver.backfill_phase` lands on. */
const PHASE_CHANNEL = 'backfillPhase';

const PHASES: ElevationBackfillPhase[] = [
  'idle',
  'fetching',
  'complete',
  'partial',
  'failed',
  'paused',
];

export interface ElevationBackfillState {
  /** idle, fetching, or one of the four terminal states. */
  phase: ElevationBackfillPhase;
  /** Activities the current or last run has finished with. */
  completed: number;
  /** Activities the current or last run started with. */
  total: number;
  /** Activities whose fetch failed, so a later run retries them. */
  failed: number;
  /**
   * Stored tracks still owed a fetch, read only at rest. Null while a pass is
   * running, which reports its own progress, and null when the engine cannot
   * answer, which must never read as a finished backfill.
   */
  remaining: number | null;
  isRunning: boolean;
  /**
   * Whether the athlete has paused the download. The phase carries the same
   * fact at rest, but a pass that ends after a pause overwrites it, so this is
   * the one the resume control reads.
   */
  isPaused: boolean;
}

const IDLE: ElevationBackfillState = {
  phase: 'idle',
  completed: 0,
  total: 0,
  failed: 0,
  remaining: null,
  isRunning: false,
  isPaused: false,
};

/** An unrecognised phase reads as idle rather than as a finished run. */
function narrowPhase(phase: string): ElevationBackfillPhase {
  return PHASES.includes(phase as ElevationBackfillPhase)
    ? (phase as ElevationBackfillPhase)
    : 'idle';
}

/**
 * The state one status read carries. Null is the engine being unable to
 * answer, which reads as idle here, never as work owed.
 *
 * The count comes with the progress rather than from a second call: Rust skips
 * it while a pass is running, where the progress figures say more, which is
 * what the two calls this replaces did between them.
 */
function stateOf(status: RoutesStatus | null): ElevationBackfillState {
  if (!status) return IDLE;
  const phase = narrowPhase(status.elevation.phase);
  return {
    phase,
    completed: status.elevation.completed,
    total: status.elevation.total,
    failed: status.elevation.failed,
    remaining: status.elevationRemaining,
    isRunning: phase === 'fetching',
    isPaused: status.elevationPaused,
  };
}

function read(): ElevationBackfillState {
  return stateOf(readRoutesStatus());
}

function same(a: ElevationBackfillState, b: ElevationBackfillState): boolean {
  return (
    a.phase === b.phase &&
    a.completed === b.completed &&
    a.total === b.total &&
    a.failed === b.failed &&
    a.remaining === b.remaining &&
    a.isPaused === b.isPaused
  );
}

export function useElevationBackfill(): ElevationBackfillState {
  const [state, setState] = useState<ElevationBackfillState>(read);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const adopt = (next: ElevationBackfillState) => {
      if (!same(stateRef.current, next)) {
        stateRef.current = next;
        setState(next);
      }
      return next;
    };
    const tick = () => adopt(read());

    let unfollow: (() => void) | undefined;
    const follow = (running: boolean) => {
      if (running && unfollow === undefined) {
        // The tick disarms itself, so a pass that ends without an
        // announcement, and an engine that stops answering and so reads as
        // idle, both stop the poll rather than leaving it running against a
        // state that has already settled.
        unfollow = followRoutesStatus((status) => follow(adopt(stateOf(status)).isRunning));
      } else if (!running && unfollow !== undefined) {
        unfollow();
        unfollow = undefined;
      }
    };
    follow(stateRef.current.isRunning);

    const engine = getEngine();
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = engine?.subscribe?.(PHASE_CHANNEL, () => follow(tick().isRunning));
    } catch {
      unsubscribe = undefined;
    }

    return () => {
      follow(false);
      unsubscribe?.();
    };
  }, []);

  return state;
}
