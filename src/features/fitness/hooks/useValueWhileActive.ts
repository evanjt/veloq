import { useState } from 'react';

/**
 * The latest `value` seen while `active` was true, and undefined until the
 * first active render.
 *
 * A page that stays mounted out of view reads from this instead of the live
 * value, so a change made on another page re-runs none of its reads until the
 * page is in front again. The value is taken while rendering, so the page
 * never commits a frame on the old value once it is active.
 */
export function useValueWhileActive<T>(value: T, active: boolean): T | undefined {
  const [held, setHeld] = useState<T | undefined>(active ? value : undefined);
  if (active && !Object.is(held, value)) setHeld(value);
  return active ? value : held;
}
