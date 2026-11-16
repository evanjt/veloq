import { useEffect, useMemo, useState } from 'react';
import type { FocusState, LiveStrengthSession } from 'veloqrs';

import {
  clearRecordingNotification,
  updateStrengthNotification,
} from '@/features/recording/lib/recordingNotification';
import { focusNames, type FocusNames } from '@/features/recording/lib/strengthFocus';

export interface StrengthFocusHandle {
  names: FocusNames;
  /** Epoch ms, advanced once a second while a rest runs, so the screen's countdown moves. */
  nowMs: number;
}

/**
 * The lock-screen notification drawn from the engine's focus read, and the clock a rest counts on.
 * Every edit answers a new session, and the read is taken again from it, so the focus view and the
 * notification both show what the engine holds and neither works out the next set or the end of
 * the rest.
 */
export function useStrengthFocus(
  session: LiveStrengthSession | null,
  focus: FocusState | null
): StrengthFocusHandle {
  const names = useMemo(
    () => (session ? focusNames(session) : { current: '', previous: null, next: null }),
    [session]
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const resting = focus?.restStartedAt != null;

  useEffect(() => {
    if (!resting) return undefined;
    const tick = () => setNowMs(Date.now());
    // The first read is a tick of its own: the clock held from before the rest began is stale.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [resting]);

  useEffect(() => {
    if (!session || !focus) {
      clearRecordingNotification();
      return;
    }
    updateStrengthNotification(focus, names, session.startedAt ?? 0);
  }, [session, focus, names]);

  useEffect(() => clearRecordingNotification, []);

  return { names, nowMs };
}
