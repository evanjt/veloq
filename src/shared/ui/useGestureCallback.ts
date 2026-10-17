import { useLayoutEffect, useState } from 'react';

interface Relay<A extends unknown[]> {
  call: (...args: A) => void;
  point: (target: ((...args: A) => void) | null) => void;
}

// Built at module level so the relay's closure holds its target and nothing
// else from the component that made it.
function createRelay<A extends unknown[]>(): Relay<A> {
  let target: ((...args: A) => void) | null = null;
  return {
    call: (...args: A) => {
      target?.(...args);
    },
    point: (next) => {
      target = next;
    },
  };
}

/**
 * The function a worklet hands to `runOnJS`. The UI runtime keeps whatever a
 * worklet captured for as long as it keeps the worklet, which outlives the
 * screen, so a callback captured directly keeps the closed screen and all it
 * read. This returns a stable relay to the latest `callback` that lets go of it
 * on unmount, after which a late call does nothing.
 */
export function useGestureCallback<A extends unknown[]>(
  callback: (...args: A) => void
): (...args: A) => void {
  const [relay] = useState(createRelay<A>);
  useLayoutEffect(() => {
    relay.point(callback);
    return () => relay.point(null);
  }, [relay, callback]);
  return relay.call;
}
