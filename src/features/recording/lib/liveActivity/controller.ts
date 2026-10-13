import { i18n } from '@/i18n';
import { formatDistance } from '@/shared/format/format';
import { getIsMetric } from '@/shared/app/UnitPreferenceStore';
import { movingMsAt, useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { getSportCategory } from '@/shared/recording/sportCategoryDetector';
import { formatRecordingSpeed } from '@/features/recording/lib/formatRecordingSpeed';
import {
  pauseRecordingManually,
  resumeRecordingManually,
} from '@/features/recording/lib/manualPause';

import { buildContentState, type LiveActivityContentState } from './contentState';
import {
  endAllNativeLiveActivities,
  endNativeLiveActivity,
  isLiveActivitySupported,
  onLiveActivityControl,
  startNativeLiveActivity,
  updateNativeLiveActivity,
} from './bridge';

/** Static for the life of the card: what the extension needs before the first state. */
interface LiveActivityAttributes {
  activityType: string;
  /** The name the card shows, translated here because the extension holds no catalogue. */
  activityLabel: string;
  sportCategory: string;
  /** The line a stale card shows once the process has stopped pushing, translated here too. */
  stoppedLabel: string;
}

let cardRunning = false;
/** A stopped ride's card, ended on its final figures and still on screen. */
let cardEndedOnScreen = false;

function composeState(now: number, endedLabel?: string): LiveActivityContentState | null {
  const state = useRecordingStore.getState();
  const { status, startTime, activityType, streams } = state;
  const live = status === 'recording' || status === 'paused';
  if (!startTime || (endedLabel === undefined ? !live : status !== 'stopped')) return null;

  const isMetric = getIsMetric();
  const distance = streams.distance[streams.distance.length - 1] ?? 0;
  const movingMs = movingMsAt(state, now);
  const movingS = Math.max(1, movingMs / 1000);
  const avgSpeed = distance / movingS;

  return buildContentState({
    status,
    now,
    movingMs,
    distanceLabel: formatDistance(distance, isMetric),
    speedLabel: formatRecordingSpeed(activityType, avgSpeed, isMetric),
    gps: streams.latlng,
    endedLabel,
  });
}

function translated(key: string, fallback: string): string {
  const t = i18n.t as unknown as (key: string) => string;
  const label = t(key);
  return label && label !== key ? label : fallback;
}

function activityLabel(type: string): string {
  return translated(`activityTypes.${type}`, type);
}

/** Start the card for the session in flight. A second call is a no-op, not a second card. */
export function beginLiveActivity(): void {
  if (cardRunning || !isLiveActivitySupported()) return;
  const state = composeState(Date.now());
  if (!state) return;

  const { activityType } = useRecordingStore.getState();
  const attributes: LiveActivityAttributes = {
    activityType: activityType ?? 'Ride',
    activityLabel: activityLabel(activityType ?? 'Ride'),
    sportCategory: getSportCategory(activityType ?? 'Ride'),
    stoppedLabel: translated(
      'recording.interruptedNotice.card',
      'Recording stopped. Open Veloq to resume.'
    ),
  };
  startNativeLiveActivity(JSON.stringify(attributes), JSON.stringify(state));
  cardRunning = true;
}

export function refreshLiveActivity(): void {
  if (!cardRunning) return;
  const state = composeState(Date.now());
  if (!state) return;
  updateNativeLiveActivity(JSON.stringify(state));
}

/**
 * End the card with the session. A ride that stopped leaves it on its final
 * figures for a while, so a rider who pockets the phone at the stop sees the
 * ride ended and was kept. A ride dropped without a stop has nothing to show.
 */
export function finishLiveActivity(): void {
  if (!cardRunning) return;
  cardRunning = false;
  const final = composeState(
    Date.now(),
    translated('recording.endedCard', 'Stopped. Open Veloq to save.')
  );
  cardEndedOnScreen = final !== null;
  endNativeLiveActivity(final ? JSON.stringify(final) : null);
}

/**
 * Clear a stopped ride's card once the ride is saved or discarded, since its
 * line asks for exactly that. The rider is in the app by then.
 */
export function dismissEndedLiveActivity(): void {
  if (!cardEndedOnScreen) return;
  cardEndedOnScreen = false;
  endAllNativeLiveActivities();
}

/**
 * Route the card's controls back through the store, so a pause from the lock
 * screen and a pause from the record screen are the same pause. "toggle" reads
 * the store rather than the button, because the card can be a tick stale.
 */
export function installLiveActivityControls(): () => void {
  return onLiveActivityControl(({ action }) => {
    const { status } = useRecordingStore.getState();
    if (status !== 'recording' && status !== 'paused') return;
    const wantsPause = action === 'pause' || (action === 'toggle' && status === 'recording');
    if (wantsPause) pauseRecordingManually();
    else resumeRecordingManually();
  });
}

/**
 * A card outlives the process that started it, so a terminated app leaves one on
 * the lock screen. Its stale date stops the clock and says the recording stopped,
 * but nothing removes it: the next launch does, before any session can start a
 * new one.
 */
export function reapOrphanedLiveActivities(): void {
  cardRunning = false;
  cardEndedOnScreen = false;
  if (!isLiveActivitySupported()) return;
  endAllNativeLiveActivities();
}
