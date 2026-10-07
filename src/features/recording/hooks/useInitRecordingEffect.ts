import { useCallback, useEffect, useRef } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import type { ActivityType } from '@/features/activity';
import { planRecordingStart } from '../lib/armCountdown';
import { getRecordingMode } from '../lib/recordingModes';
import { readPlannedWorkout } from '../lib/plannedWorkout';
import type { RecordingMode, RecordingStatus } from '../types';

export interface InitRecordingState {
  /**
   * Begin the ride under the sport held now. This is the Start button on a
   * screen reached idle, and it begins nothing twice.
   */
  startNow: () => void;
}

/**
 * Recording screens mounted, oldest first. The one on top owns a sport picked
 * before a start, and when it goes the one beneath owns it again.
 */
const choosingScreens: object[] = [];

/**
 * Start the recording on arrival, or leave it idle behind its Start button.
 *
 * `canRecord` is not a courtesy: every one-tap surface deep-links straight to
 * this screen, so this hook is the only thing between a signed-out tap and a
 * full ride recorded against no account.
 *
 * A one-tap system entry stays idle, because a pocket tap on a widget, an iOS
 * Control or a launcher shortcut used to record a ride and write its FIT
 * backup. The entry screen's Start and the picker begin on arrival.
 */
export function useInitRecordingEffect(
  status: RecordingStatus,
  activityType: ActivityType,
  pairedEventId?: string,
  canRecord: boolean = true,
  from?: string,
  mode: RecordingMode = getRecordingMode(activityType)
): InitRecordingState {
  const plan = planRecordingStart({ canRecord, status, from, mode });

  // The ride is decided once, so a second Start cannot begin it again. A
  // screen that mounts on a ride already under way has decided it too: the
  // idle that follows a discard or save beneath the review is not a start.
  const startedRef = useRef(status !== 'idle');

  const begin = useCallback(() => {
    startedRef.current = true;
    // The sport is read here rather than closed over, because the athlete may
    // have corrected a wrong tap before the ride began. The route param is what
    // they tapped; the store holds what they chose after it.
    // The mode follows the same choice, or a Ride corrected to VirtualRide
    // would run a GPS watch on a trainer and record nothing.
    const chosen = useRecordingStore.getState().activityType ?? activityType;
    const chosenMode = getRecordingMode(chosen);
    const eventId = pairedEventId ? Number(pairedEventId) : undefined;
    useRecordingStore.getState().startRecording(chosen, chosenMode, eventId);
    // The plan is read here, once, and frozen with the recording. A manual
    // session follows its plan on its own screen.
    if (eventId != null && chosenMode !== 'manual') {
      useRecordingStore.getState().followWorkout(readPlannedWorkout(eventId));
    }
    useRecordingPreferences.getState().addRecentType(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The chosen sport is read from the store when recording starts.
  }, []);

  const startNow = useCallback(() => {
    if (startedRef.current) return;
    begin();
  }, [begin]);

  // A sport picked before a start belongs to the screen it was picked on. The
  // store outlives that screen, and a widget can open a second one over it, so
  // a screen opening clears a choice it did not make, and a screen leaving
  // clears its own only while it is the one on top. Declared before the start
  // below, which reads the choice on mount.
  useEffect(() => {
    const screen = {};
    choosingScreens.push(screen);
    const { status, activityType: held } = useRecordingStore.getState();
    if (status === 'idle' && held !== null) useRecordingStore.setState({ activityType: null });
    return () => {
      const onTop = choosingScreens[choosingScreens.length - 1] === screen;
      choosingScreens.splice(choosingScreens.indexOf(screen), 1);
      if (!onTop) return;
      const now = useRecordingStore.getState();
      if (now.status !== 'idle' || now.activityType === null) return;
      useRecordingStore.setState({ activityType: null });
    };
  }, []);

  useEffect(() => {
    if (plan === 'start') startNow();
  }, [plan, startNow]);

  return { startNow };
}
