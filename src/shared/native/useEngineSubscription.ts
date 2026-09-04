/**
 * Subscribe to engine change channels and re-render when one fires.
 *
 * This lives in `shared/native` rather than beside its routes callers because
 * shared hooks that reach into `features/routes` pull the static native
 * binding chain into every consumer. The lazy `getEngine` loader does not.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { getEngine } from './engine';

export type EngineEvent = 'activities' | 'groups' | 'sections';

/**
 * Returns a trigger value that changes when any subscribed event fires.
 *
 * If the engine is not available on first mount, polls until it becomes
 * available to avoid permanently missing events.
 */
export function useEngineSubscription(events: EngineEvent[]): number {
  const [trigger, setTrigger] = useState(0);

  // Stable ref for the refresh callback to avoid stale closures
  const refreshRef = useRef(() => setTrigger((t) => t + 1));
  refreshRef.current = () => setTrigger((t) => t + 1);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const eventKey = useMemo(() => events.join(','), [events.join(',')]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribes: (() => void)[] = [];

    function trySubscribe(): boolean {
      const engine = getEngine();
      if (!engine) return false;

      const cb = () => refreshRef.current();
      unsubscribes = events.map((event) => engine.subscribe(event, cb));
      // Trigger initial refresh in case data arrived before subscription
      if (!cancelled) {
        refreshRef.current();
      }
      return true;
    }

    if (!trySubscribe()) {
      // Engine not ready yet - poll until available
      const interval = setInterval(() => {
        if (trySubscribe()) {
          clearInterval(interval);
        }
      }, 200);

      return () => {
        cancelled = true;
        clearInterval(interval);
        unsubscribes.forEach((u) => u());
      };
    }

    return () => {
      cancelled = true;
      unsubscribes.forEach((u) => u());
    };
  }, [eventKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return trigger;
}
