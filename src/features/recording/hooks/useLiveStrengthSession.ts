import { useCallback, useState } from 'react';

import {
  strength,
  type FfiFocusState,
  type LiveStrengthEdit,
  type FfiLiveStrengthSession,
  type StrengthStart,
} from 'veloqrs';

const nowSeconds = () => Date.now() / 1000;

export interface LiveStrengthSessionHandle {
  /** The session as the engine last answered it; null when none is live. */
  session: FfiLiveStrengthSession | null;
  /** The engine's focus read taken with that answer, so a focus view and the lock screen agree with it. */
  focus: FfiFocusState | null;
  /** For the exercise just added with sets from an earlier session, the whole days since. */
  prefilledDaysAgo: number | null;
  /** The engine refused the last change and kept the session as it was. */
  refused: boolean;
  /** Start the session from a source. False when the engine refused. */
  start: (from: StrengthStart) => FfiLiveStrengthSession | null | false;
  /** Start the session from the lines of a planned workout. False when the engine refused. */
  startFromPlan: (lines: string[]) => FfiLiveStrengthSession | null | false;
  /** Make one change. Answers the session after it, or false when the engine refused. */
  edit: (change: LiveStrengthEdit) => FfiLiveStrengthSession | null | false;
  discard: () => void;
}

/**
 * The live strength session. It keeps the engine's last answer to draw and nothing else: every
 * change is one engine call, and what the engine answers replaces what was drawn, so a rule the
 * engine applies to the sets below the one changed is never worked out here. A change the engine
 * refuses throws, and the session stays as it was.
 */
export function useLiveStrengthSession(): LiveStrengthSessionHandle {
  const [session, setSession] = useState<FfiLiveStrengthSession | null>(() =>
    strength.getLiveStrengthSession()
  );
  const [focus, setFocus] = useState<FfiFocusState | null>(() =>
    session ? strength.getLiveFocusState() : null
  );
  const [prefilledDaysAgo, setPrefilledDaysAgo] = useState<number | null>(null);
  const [refused, setRefused] = useState(false);

  const answer = useCallback((next: FfiLiveStrengthSession | null) => {
    setSession(next);
    setFocus(next ? strength.getLiveFocusState() : null);
  }, []);

  const begin = useCallback(
    (run: () => FfiLiveStrengthSession | null) => {
      try {
        const started = run();
        setRefused(false);
        setPrefilledDaysAgo(null);
        answer(started);
        return started;
      } catch {
        setRefused(true);
        return false;
      }
    },
    [answer]
  );

  const start = useCallback(
    (from: StrengthStart) => begin(() => strength.startLiveStrengthSession(from, nowSeconds())),
    [begin]
  );

  const startFromPlan = useCallback(
    (lines: string[]) =>
      begin(() => strength.startLiveStrengthSessionFromPlan(lines, nowSeconds())),
    [begin]
  );

  const edit = useCallback(
    (change: LiveStrengthEdit) => {
      try {
        const outcome = strength.editLiveStrengthSession(change, nowSeconds());
        if (!outcome) return null;
        setRefused(false);
        setPrefilledDaysAgo(outcome.prefilledDaysAgo ?? null);
        answer(outcome.session);
        return outcome.session;
      } catch {
        setRefused(true);
        return false;
      }
    },
    [answer]
  );

  const discard = useCallback(() => {
    strength.discardLiveStrengthSession();
    answer(null);
    setPrefilledDaysAgo(null);
    setRefused(false);
  }, [answer]);

  return { session, focus, prefilledDaysAgo, refused, start, startFromPlan, edit, discard };
}
