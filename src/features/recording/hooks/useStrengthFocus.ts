import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { FfiFocusState, FfiLiveStrengthSession } from 'veloqrs';

import {
  clearRecordingNotification,
  updateStrengthNotification,
} from '@/features/recording/lib/recordingNotification';
import {
  endStrengthLiveActivity,
  pushStrengthLiveActivity,
} from '@/features/recording/lib/liveActivity/controller';
import {
  createRestAlert,
  notificationRestAlertPort,
} from '@/features/recording/lib/liveActivity/restAlert';
import { buildStrengthContentState } from '@/features/recording/lib/liveActivity/strengthContentState';
import {
  focusNames,
  focusSetText,
  type FocusNames,
  type FocusTranslate,
} from '@/features/recording/lib/strengthFocus';
import { i18n } from '@/i18n';

interface StrengthFocusHandle {
  names: FocusNames;
  /** Epoch ms, advanced once a second while a rest runs, so the screen's countdown moves. */
  nowMs: number;
}

const translate: FocusTranslate = (key, fallback, values) =>
  (i18n.t as unknown as FocusTranslate)(key, fallback, values);

/**
 * The lock-screen surfaces drawn from the engine's focus read, and the clock a rest counts on.
 * Every edit answers a new session, and the read is taken again from it, so the focus view and the
 * notification both show what the engine holds and neither works out the next set or the end of
 * the rest.
 */
export function useStrengthFocus(
  session: FfiLiveStrengthSession | null,
  focus: FfiFocusState | null
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

  // iPhone: the card and the rest-end alert follow the same focus read. Android's notification
  // above carries its own countdown and vibration, so it takes no second alert.
  const restAlert = useRef(createRestAlert(notificationRestAlertPort));
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const now = Date.now();
    const state = session ? buildStrengthContentState(focus, names, now, translate) : null;
    if (!state || !focus?.current) {
      endStrengthLiveActivity();
      void restAlert.current.clear();
      return;
    }
    pushStrengthLiveActivity(state, 'WeightTraining');
    const title = translate('strength.focus.nextSet', 'Next: {{set}}', {
      set: `${names.current} · ${focusSetText(focus.current, translate)}`,
    });
    void restAlert.current.sync(state.restEndsAt, now, title);
  }, [session, focus, names]);

  useEffect(
    () => () => {
      endStrengthLiveActivity();
      void restAlert.current.clear();
    },
    []
  );

  return { names, nowMs };
}
