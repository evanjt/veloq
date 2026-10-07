/**
 * Reads the stream backfill's progress for the Settings row that shows it.
 *
 * The engine starts this pass by itself after a settled sync and announces
 * every phase it enters, so a mounted row at rest arms its follow on an
 * announced `fetching` or `awaiting_consent`. A live pass is polled and only a
 * live pass is; the poll disarms itself when the pass ends. The row starts one
 * only after a stop. At rest the answer comes from
 * `getStreamBackfillRemaining`, a count of activities with no stored series,
 * which is durable and survives the process the phase does not.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getEngine } from '@/shared/native/engine';
import { useSyncState } from '@/shared/native/useSyncStatus';
import { StartOutcome } from 'veloqrs';
import type { RoutesStatus, StreamBackfillPhase } from 'veloqrs';

import { followRoutesStatus, readRoutesStatus } from '@/shared/native/routesStatusPoll';

/** The channel `EngineObserver.stream_backfill_phase` lands on. */
const PHASE_CHANNEL = 'streamBackfillPhase';

const PHASES: StreamBackfillPhase[] = [
  'idle',
  'fetching',
  'complete',
  'partial',
  'stopped',
  'failed',
  'awaiting_consent',
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
  /** The engine is holding a large download for the athlete's answer. */
  awaitingConsent: boolean;
  /** Requests the held pass would make, from the engine. */
  estimateRequests: number;
  /** Megabytes the held pass would download, from the engine's byte figure. */
  estimateMegabytes: number;
}

const IDLE: StreamBackfillState = {
  phase: 'idle',
  completed: 0,
  total: 0,
  stored: 0,
  remaining: null,
  isRunning: false,
  awaitingConsent: false,
  estimateRequests: 0,
  estimateMegabytes: 0,
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
    awaitingConsent: phase === 'awaiting_consent',
    estimateRequests: status.stream.estimateRequests,
    estimateMegabytes: Math.round(status.stream.estimateBytes / 1_000_000),
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
    a.remaining === b.remaining &&
    a.awaitingConsent === b.awaitingConsent &&
    a.estimateRequests === b.estimateRequests &&
    a.estimateMegabytes === b.estimateMegabytes
  );
}

export interface StreamBackfillControls extends StreamBackfillState {
  /** Why the last tap on Download did not start a pass, or null. */
  refusal: StartOutcome | null;
  start: () => void;
  stop: () => void;
}

export function useStreamBackfill(): StreamBackfillControls {
  const [state, setState] = useState<StreamBackfillState>(read);
  const mounted = useRef(state);
  const [refusal, setRefusal] = useState<StartOutcome | null>(null);
  const arm = useRef<(running: boolean) => void>(() => {});
  const refresh = useRef<() => void>(() => {});
  // The engine decides whether to ask when a sync settles, and announces
  // nothing, so the read is repeated when the sync state moves.
  const syncState = useSyncState();

  useEffect(() => {
    // The last state handed to React, held in the effect's own closure rather
    // than in a ref written during render.
    let latest = mounted.current;

    const adopt = (next: StreamBackfillState) => {
      if (!same(latest, next)) {
        latest = next;
        setState(next);
        // A pass that is running answers the refusal that came before it.
        if (next.isRunning) setRefusal(null);
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
    refresh.current = () => follow(adopt(read()).isRunning);
    follow(latest.isRunning);

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = getEngine()?.subscribe?.(PHASE_CHANNEL, () => refresh.current());
    } catch {
      unsubscribe = undefined;
    }

    return () => {
      unsubscribe?.();
      follow(false);
      arm.current = () => {};
      refresh.current = () => {};
    };
  }, []);

  useEffect(() => {
    refresh.current();
  }, [syncState]);

  // The athlete's own tap is the consent: the engine records the yes and
  // starts, so later automatic passes do not ask again. Armed off the start
  // rather than off the next render: the pass is already fetching by the time
  // this returns.
  const start = useCallback(() => {
    let outcome: StartOutcome | undefined;
    try {
      outcome = getEngine()?.consentStreamBackfill?.();
    } catch {
      outcome = StartOutcome.Failed;
    }
    const refused = outcome !== undefined && outcome !== StartOutcome.Started;
    setRefusal(refused ? (outcome ?? null) : null);
    // A refused start spawned nothing, so arming the follow would only disarm
    // on its first idle read.
    if (!refused) arm.current(true);
    refresh.current();
  }, []);

  const stop = useCallback(() => {
    getEngine()?.stopStreamBackfill?.();
    refresh.current();
  }, []);

  return { ...state, refusal, start, stop };
}
