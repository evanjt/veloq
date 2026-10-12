/**
 * Subscribe to engine change channels and re-render when one fires.
 *
 * This lives in `shared/native` rather than beside its routes callers because
 * shared hooks that reach into `features/routes` pull the static native
 * binding chain into every consumer. The lazy `getEngine` loader does not, and
 * neither does the engine status store `useEngineReady` reads: that store
 * imports `zustand` and nothing else.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';

import { getEngine, isEngineReady } from './engine';
import { useEngineReady } from './useEngineReady';

/**
 * The channels this hook forwards to `engine.subscribe`. It is a narrower list
 * than `EngineClient`'s own, spelled here rather than imported, so a consumer
 * does not take the static native binding chain for a string literal.
 * `detectionApplied` is on it because a detection run renames, splits and
 * retires sections, and nothing else announces that it finished, and
 * `fitParsed` because a FIT landing is what turns an awaiting strength tab
 * into a ready one. `gpsTrackStored` is on it because a bulk download stores
 * tracks one at a time and announces nothing on `activities` until it ends.
 */
export type EngineEvent =
  | 'activities'
  | 'groups'
  | 'sections'
  | 'detectionApplied'
  | 'backfillPhase'
  | 'streamBackfillPhase'
  | 'fitParsed'
  | 'gpsTrackStored'
  | 'cutoverSettled';

/**
 * Returns a trigger value that changes when any subscribed event fires.
 *
 * If the engine is not available on first mount, polls until it becomes
 * available and bumps the trigger once it is, to avoid permanently missing
 * events.
 */
export function useEngineSubscription(events: EngineEvent[]): number {
  return useEventGeneration(events, true);
}

/**
 * The trigger behind both hooks. `bumpOnArrival` is the late-subscription
 * refresh, which a reader keyed on the open itself does not need: the render
 * that saw the open already read, and a second bump would read again.
 */
function useEventGeneration(events: EngineEvent[], bumpOnArrival: boolean): number {
  const [trigger, setTrigger] = useState(0);

  // Stable ref for the refresh callback to avoid stale closures
  const refreshRef = useRef(() => setTrigger((t) => t + 1));
  refreshRef.current = () => setTrigger((t) => t + 1);

  // The joined list is the identity: callers pass a fresh array literal every
  // render, so its reference is never stable and the string is what the effect
  // below can be keyed on. Memoising it on itself bought nothing.
  const eventKey = events.join(',');

  // A subscription that arrives after the first render can have missed a
  // change, so it refreshes on arrival. The first one cannot: the render that
  // saw the engine read the current state.
  const engine = useEngineReady();
  const missedRef = useRef(false);

  useEffect(() => {
    if (!engine) {
      missedRef.current = true;
      return undefined;
    }

    // Rebuilt from the key rather than read from `events`, so the key is the
    // whole dependency and a changed list cannot hide behind an unchanged one.
    // An empty key splits to one empty name, which is no channel at all.
    const list = eventKey === '' ? [] : (eventKey.split(',') as EngineEvent[]);
    const cb = () => refreshRef.current();
    const unsubscribes = list.map((event) => engine.subscribe(event, cb));
    if (missedRef.current && bumpOnArrival) {
      refreshRef.current();
    }
    missedRef.current = false;

    return () => {
      unsubscribes.forEach((u) => u());
    };
  }, [eventKey, engine, bumpOnArrival]);

  return trigger;
}

/**
 * A reader whose identity changes when a subscribed event fires, and at no
 * other time.
 *
 * The counter [`useEngineSubscription`] returns is a key, not a value: a caller
 * lists it in a memo's deps so the read re-runs after a sync, and the memo's
 * body never touches it. The hooks dependency rule is then right on the
 * syntax and wrong on the purpose, and the reflex it invites, deleting the
 * name, leaves the read showing what was true at mount.
 *
 * So the key becomes something the body does use. The memo calls this reader,
 * depends on it honestly, and re-runs exactly when the engine has announced
 * that its answer moved:
 *
 *     const readSections = useEngineRead(['sections']);
 *     const rows = useMemo(
 *       () => readSections((engine) => engine.getSectionById(id)),
 *       [id, readSections]
 *     );
 *
 * `keys` are the caller's own reasons to look again, a refresh counter bumped
 * after an edit or a pull-to-refresh, which no engine event announces. They
 * move the reader's identity the same way an announcement does, so the memo
 * still names one honest dependency. An empty event list is a reader keyed on
 * those alone.
 *
 * `undefined` when the engine is not open, which is the same answer a caller
 * got from `getEngine()?.x()` and needs no new branch.
 */
export type EngineReadKey = string | number | boolean | null | undefined;

export function useEngineRead(
  events: EngineEvent[],
  keys: readonly EngineReadKey[] = []
): <T>(read: (engine: NonNullable<ReturnType<typeof getEngine>>) => T) => T | undefined {
  // The handle exists before it opens and answers every read with its empty
  // default, and opening it announces nothing on any channel. So the open is a
  // reason to look again in its own right, or a screen mounted while the
  // engine was opening keeps the empty answer it got. It also covers a handle
  // that arrived late, which is why the subscription's own arrival bump is off.
  const generation = useEventGeneration(events, false);
  const opened = useEngineStatus((s) => s.readyNonce);
  // Callers pass a fresh array literal every render, so the serialised keys
  // are the identity, the same reasoning as the event key above.
  const keyId = JSON.stringify(keys);

  // The generation, the open and the keys are the whole dependency: a new
  // identity per announcement, open or key move is what re-runs every memo
  // keyed on this reader, and holding it stable in between is what stops one
  // re-running on an unrelated render.
  return useCallback(
    <T>(read: (engine: NonNullable<ReturnType<typeof getEngine>>) => T): T | undefined => {
      void generation;
      void opened;
      void keyId;
      const engine = getEngine();
      return engine ? read(engine) : undefined;
    },
    [generation, opened, keyId]
  );
}

/**
 * Whether a read can be believed: the engine is open, still opening, or gave
 * up opening.
 *
 * A handle that is not open answers every read with its empty default, so a
 * reader's rows cannot tell an empty library from one that is not open. This
 * is the one place that tells them apart, and every surface that would
 * otherwise say "there are none" asks it first: `closed` draws a placeholder,
 * `failed` says why with a Retry, and only `ready` with no rows is empty.
 */
export type EngineReadState = 'ready' | 'closed' | 'failed';

export function engineReadState(open: boolean, initFailed: boolean): EngineReadState {
  if (open) return 'ready';
  return initFailed ? 'failed' : 'closed';
}

/** The same answer outside React, for a reader that runs once rather than renders. */
export function currentEngineReadState(): EngineReadState {
  return engineReadState(isEngineReady(), useEngineStatus.getState().initFailed);
}

export function useEngineReadState(): EngineReadState {
  // The nonce moves when the engine opens or its handle is replaced, which is
  // when `isEngineReady` can change its answer.
  useEngineStatus((s) => s.readyNonce);
  const initFailed = useEngineStatus((s) => s.initFailed);
  return engineReadState(isEngineReady(), initFailed);
}

/**
 * A key and the call that moves it, for a read that offers a retry.
 *
 * A failed read is a memo like any other and stays failed until one of its
 * keys moves. Passed to `useEngineRead` beside the caller's own keys, this one
 * lets a Retry read again without waiting for the engine to announce a change.
 */
export function useReadRetry(): [attempt: number, retry: () => void] {
  return useReducer(nextAttempt, 0);
}

function nextAttempt(attempt: number): number {
  return attempt + 1;
}
