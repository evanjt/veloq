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
import type { StreamBackfillPhase } from 'veloqrs';

const POLL_INTERVAL_MS = 500;

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

function read(): StreamBackfillState {
  const engine = getEngine();
  if (!engine) return IDLE;
  const progress = engine.getStreamBackfillProgress?.();
  if (!progress) return IDLE;
  const phase = narrowPhase(progress.phase);
  const isRunning = phase === 'fetching';
  return {
    phase,
    completed: progress.completed,
    total: progress.total,
    stored: progress.stored,
    remaining: isRunning ? null : (engine.getStreamBackfillRemaining?.() ?? null),
    isRunning,
  };
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

    const tick = () => {
      const next = read();
      if (!same(latest, next)) {
        latest = next;
        setState(next);
      }
      return next;
    };

    let timer: ReturnType<typeof setInterval> | undefined;
    // The tick disarms itself, so a pass that ends, and an engine that stops
    // answering and so reads as idle, both stop the poll rather than leaving it
    // running against a state that has already settled.
    const follow = (running: boolean) => {
      if (running && timer === undefined) {
        timer = setInterval(() => follow(tick().isRunning), POLL_INTERVAL_MS);
      } else if (!running && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
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
