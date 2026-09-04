import { useCallback, useEffect, useState } from 'react';

import { getEngine } from '@/shared/native/engine';

/** How often the hold is re-read while it is on. Nothing polls once it lifts. */
const RECHECK_MS = 5000;

function readHold(): boolean {
  const engine = getEngine();
  if (!engine) return false;
  try {
    return !!engine.isCutoverPending?.() || !!engine.isCutoverRunning?.();
  } catch {
    return false;
  }
}

/**
 * Whether the engine is refusing to detect because the detector migration has
 * not run yet. Every apply stamps this build's detector on the catalogue, so a
 * detect that beats the migration would retire it over a catalogue nothing had
 * captured, which is why the engine refuses (`SB12`).
 *
 * The hold turns off at most once in an install's life, so this reads on the
 * `sections` channel, which the migration's own detect fires, and keeps a slow
 * timer only while the hold is on.
 */
export function useDetectionHold(): boolean {
  const [held, setHeld] = useState(readHold);

  const recheck = useCallback(() => {
    const next = readHold();
    setHeld((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    const engine = getEngine();
    if (!engine) return undefined;
    return engine.subscribe('sections', recheck);
  }, [recheck]);

  useEffect(() => {
    if (!held) return undefined;
    const timer = setInterval(recheck, RECHECK_MS);
    return () => clearInterval(timer);
  }, [held, recheck]);

  return held;
}
