import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A mount deferred by `delayMs` that comes back after a failure. `onError` takes
 * the mount down and arms it again after the same delay, at most `maxRetries`
 * times, so one render error does not remove it for the life of the screen.
 */
export function useRearmingMount(delayMs: number, maxRetries: number) {
  const [mounted, setMounted] = useState(false);
  const retries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setMounted(true);
    }, delayMs);
  }, [delayMs]);

  useEffect(() => {
    arm();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [arm]);

  const onError = useCallback(() => {
    setMounted(false);
    if (retries.current >= maxRetries) return;
    retries.current += 1;
    arm();
  }, [arm, maxRetries]);

  return { mounted, onError };
}
