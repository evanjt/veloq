/**
 * Subscribe to engine change channels and re-render when one fires.
 *
 * This lives in `shared/native` rather than beside its routes callers because
 * shared hooks that reach into `features/routes` pull the static native
 * binding chain into every consumer. The lazy `getEngine` loader does not, and
 * neither does the ready nonce `useEngineReady` reads: that store imports
 * `zustand` and nothing else.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { useEngineReady } from './useEngineReady';

export type EngineEvent = 'activities' | 'groups' | 'sections';

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const eventKey = useMemo(() => events.join(','), [events.join(',')]);

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

    const cb = () => refreshRef.current();
    const unsubscribes = events.map((event) => engine.subscribe(event, cb));
    if (missedRef.current && !cancelled) {
      refreshRef.current();
    }
    missedRef.current = false;

    return () => {
      cancelled = true;
      unsubscribes.forEach((u) => u());
    };
  }, [eventKey, engine]); // eslint-disable-line react-hooks/exhaustive-deps

  return trigger;
}
