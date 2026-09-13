import { useCallback, useEffect, useRef, useState } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import type { ActivityType } from '@/features/activity/types';
import { ARM_COUNTDOWN_SECONDS, planRecordingStart } from '../lib/armCountdown';
import type { RecordingMode, RecordingStatus } from '../types';

export interface InitRecordingState {
  /** Seconds left before the ride starts, or null when nothing is armed. */
  countdown: number | null;
  /** Stop the armed start. Nothing is recorded and no FIT is written. */
  cancelCountdown: () => void;
}

/**
 * Start the recording on arrival, or arm it.
 *
 * `canRecord` is not a courtesy: every one-tap surface deep-links straight to
 * this screen, so this hook is the only thing between a signed-out tap and a
 * full ride recorded against no account.
 *
 * A one-tap entry arms a countdown rather than starting, because a pocket tap
 * on a widget, an iOS Control or a launcher shortcut used to record a ride and
 * write its FIT backup. The picker path starts on arrival, since getting there
 * was already the athlete's second tap.
 */
export function useInitRecordingEffect(
  status: RecordingStatus,
  activityType: ActivityType,
  mode: RecordingMode,
  pairedEventId?: string,
  canRecord: boolean = true,
  from?: string
): InitRecordingState {
  const plan = planRecordingStart({ canRecord, status, from });
  const [countdown, setCountdown] = useState<number | null>(
    plan === 'arm' ? ARM_COUNTDOWN_SECONDS : null
  );

  // The ride is decided once. A cancel that arrives after the countdown fired
  // is the existing discard, not this, and must not undo a started recording;
  // a tick that fires after a cancel must not start one.
  const outcomeRef = useRef<'pending' | 'started' | 'cancelled'>('pending');
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const leftRef = useRef(ARM_COUNTDOWN_SECONDS);

  const stopTicking = useCallback(() => {
    if (tickRef.current === null) return;
    clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (outcomeRef.current !== 'pending') return;
    outcomeRef.current = 'started';
    stopTicking();
    setCountdown(null);
    // The sport is read here rather than closed over, because the athlete may
    // have corrected a wrong tap inside the window. The route param is what
    // they tapped; the store holds what they chose after it.
    const chosen = useRecordingStore.getState().activityType ?? activityType;
    useRecordingStore
      .getState()
      .startRecording(chosen, mode, pairedEventId ? Number(pairedEventId) : undefined);
    useRecordingPreferences.getState().addRecentType(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopTicking]);

  const cancelCountdown = useCallback(() => {
    if (outcomeRef.current !== 'pending') return;
    outcomeRef.current = 'cancelled';
    stopTicking();
    setCountdown(null);
  }, [stopTicking]);

  useEffect(() => {
    if (plan === 'nothing') return undefined;
    if (plan === 'start') {
      start();
      return undefined;
    }

    // The decision is made here rather than inside a state updater, so a tick
    // and a cancel in the same frame resolve in the order they happened.
    tickRef.current = setInterval(() => {
      leftRef.current -= 1;
      if (leftRef.current <= 0) {
        start();
        return;
      }
      setCountdown(leftRef.current);
    }, 1000);

    // Leaving the screen inside the window records nothing: the tap that armed
    // it is not a decision to ride.
    return stopTicking;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { countdown, cancelCountdown };
}
