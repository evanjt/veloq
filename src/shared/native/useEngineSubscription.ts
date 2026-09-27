/**
 * Subscribe to engine change channels and re-render when one fires.
 *
 * This lives in `shared/native` rather than beside its routes callers because
 * shared hooks that reach into `features/routes` pull the static native
 * binding chain into every consumer. The lazy `getEngine` loader does not, and
 * neither does the ready nonce `useEngineReady` reads: that store imports
 * `zustand` and nothing else.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { getEngine } from './engine';
import { useEngineReady } from './useEngineReady';

/**
 * The channels this hook forwards to `engine.subscribe`. It is a narrower list
 * than `EngineClient`'s own, spelled here rather than imported, so a consumer
 * does not take the static native binding chain for a string literal.
 * `detectionApplied` is on it because a detection run renames, splits and
 * retires sections, and nothing else announces that it finished, and
 * `fitParsed` because a FIT landing is what turns an awaiting strength tab
 * into a ready one.
 */
export type EngineEvent = 'activities' | 'groups' | 'sections' | 'detectionApplied' | 'fitParsed';

/**
 * Returns a trigger value that changes when any subscribed event fires.
 *
 * If the engine is not available on first mount, polls until it becomes
 * available and bumps the trigger once it is, to avoid permanently missing
 * events.
 */
export function useEngineSubscription(events: EngineEvent[]): number {
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
    let cancelled = false;

    // Rebuilt from the key rather than read from `events`, so the key is the
    // whole dependency and a changed list cannot hide behind an unchanged one.
    // An empty key splits to one empty name, which is no channel at all.
    const list = eventKey === '' ? [] : (eventKey.split(',') as EngineEvent[]);
    const cb = () => refreshRef.current();
    const unsubscribes = list.map((event) => engine.subscribe(event, cb));
    if (missedRef.current && !cancelled) {
      refreshRef.current();
    }
    missedRef.current = false;

    return () => {
      cancelled = true;
      unsubscribes.forEach((u) => u());
    };
  }, [eventKey, engine]);

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
 *       () => readSections((engine) => engine.getExcludedRouteActivityIds(id)),
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
  const generation = useEngineSubscription(events);
  // Callers pass a fresh array literal every render, so the serialised keys
  // are the identity, the same reasoning as the event key above.
  const keyId = JSON.stringify(keys);

  // The generation and the keys are the whole dependency: a new identity per
  // announcement or key move is what re-runs every memo keyed on this reader,
  // and holding it stable in between is what stops one re-running on an
  // unrelated render.
  return useCallback(
    <T>(read: (engine: NonNullable<ReturnType<typeof getEngine>>) => T): T | undefined => {
      void generation;
      void keyId;
      const engine = getEngine();
      return engine ? read(engine) : undefined;
    },
    [generation, keyId]
  );
}
