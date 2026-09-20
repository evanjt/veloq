/**
 * Reads the stream backfill's progress for the Settings row that starts it.
 *
 * Nothing in Rust announces this pass, because nothing but this row starts one:
 * a live pass is polled and only a live pass is. At rest the answer comes from
 * `getStreamBackfillRemaining`, a count of activities with no stored series,
 * which is durable and survives the process the phase does not.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getEngine } from '@/shared/native/engine';
import type { RoutesStatus, StreamBackfillPhase } from 'veloqrs';

import { followRoutesStatus, readRoutesStatus } from '@/shared/native/routesStatusPoll';

const PHASES: StreamBackfillPhase[] = [
  'idle',
  'fetching',
  'complete',
  'partial',
  'stopped',
  'failed',
];

export interface StreamBackfillState {
  /** idle, fetching, or one of the four terminal states. */
  phase: StreamBackfillPhase;
  /** Activities the current or last pass has finished with. */
  completed: number;
  /** Activities the current or last pass started with. */
  total: number;
  /** Activities whose series landed in the store. */
  stored: number;
  /**
   * Activities still owed an ask, read only at rest. Null while a pass is
   * running, which reports its own progress, and null when the engine cannot
   * answer, which must never read as a stocked library.
   */
  remaining: number | null;
  isRunning: boolean;
}

const IDLE: StreamBackfillState = {
  phase: 'idle',
  completed: 0,
  total: 0,
  stored: 0,
  remaining: null,
  isRunning: false,
};

/** An unrecognised phase reads as idle rather than as a finished pass. */
function narrowPhase(phase: string): StreamBackfillPhase {
  return PHASES.includes(phase as StreamBackfillPhase) ? (phase as StreamBackfillPhase) : 'idle';
}

/**
 * The state one status read carries. The count comes with the progress rather
 * than from a second call: Rust withholds it while a pass is running, where
 * the progress figures say more, which is what the two calls this replaces did
 * between them.
 */
function stateOf(status: RoutesStatus | null): StreamBackfillState {
  if (!status) return IDLE;
  const phase = narrowPhase(status.stream.phase);
  return {
    phase,
    completed: status.stream.completed,
    total: status.stream.total,
    stored: status.stream.stored,
    remaining: status.streamRemaining,
    isRunning: phase === 'fetching',
  };
}

function read(): StreamBackfillState {
  return stateOf(readRoutesStatus());
}

function same(a: StreamBackfillState, b: StreamBackfillState): boolean {
  return (
    a.phase === b.phase &&
    a.completed === b.completed &&
    a.total === b.total &&
    a.stored === b.stored &&
    a.remaining === b.remaining
  );
}

export interface StreamBackfillControls extends StreamBackfillState {
  start: () => void;
  stop: () => void;
}

export function useStreamBackfill(): StreamBackfillControls {
  const [state, setState] = useState<StreamBackfillState>(read);
  const mounted = useRef(state);
  const arm = useRef<(running: boolean) => void>(() => {});

  useEffect(() => {
    // The last state handed to React, held in the effect's own closure rather
    // than in a ref written during render.
    let latest = mounted.current;

    const adopt = (next: StreamBackfillState) => {
      if (!same(latest, next)) {
        latest = next;
        setState(next);
      }
      return next;
    };

    let unfollow: (() => void) | undefined;
    // The tick disarms itself, so a pass that ends, and an engine that stops
    // answering and so reads as idle, both stop the poll rather than leaving it
    // running against a state that has already settled.
    const follow = (running: boolean) => {
      if (running && unfollow === undefined) {
        unfollow = followRoutesStatus((status) => follow(adopt(stateOf(status)).isRunning));
      } else if (!running && unfollow !== undefined) {
        unfollow();
        unfollow = undefined;
      }
    };
    arm.current = follow;
    follow(latest.isRunning);

    return () => {
      follow(false);
      arm.current = () => {};
    };
  }, []);

  const start = useCallback(() => {
    getEngine()?.startStreamBackfill?.();
    // Armed off the start rather than off the next render: the pass is already
    // fetching by the time this returns.
    arm.current(true);
  }, []);

  const stop = useCallback(() => {
    getEngine()?.stopStreamBackfill?.();
  }, []);

  return { ...state, start, stop };
}
