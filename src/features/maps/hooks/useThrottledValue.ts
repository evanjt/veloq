import { useEffect, useRef, useState } from 'react';

/**
 * Holds a value at no more than one change per `intervalMs`, keeping the last
 * one that arrives.
 *
 * Chart scrubbing and the trim slider both change geometry faster than a map
 * needs to redraw. Throttling on the way in costs one render instead of a full
 * source update per frame, and the trailing edge guarantees the map settles on
 * the value the user actually stopped at.
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [held, setHeld] = useState(value);
  const lastAppliedRef = useRef(0);

  useEffect(() => {
    const elapsed = Date.now() - lastAppliedRef.current;
    if (elapsed >= intervalMs) {
      lastAppliedRef.current = Date.now();
      setHeld(value);
      return;
    }
    const timer = setTimeout(() => {
      lastAppliedRef.current = Date.now();
      setHeld(value);
    }, intervalMs - elapsed);
    return () => clearTimeout(timer);
  }, [value, intervalMs]);

  return held;
}
