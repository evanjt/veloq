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
}

let cardRunning = false;

function composeState(now: number): LiveActivityContentState | null {
  const state = useRecordingStore.getState();
  const { status, startTime, activityType, streams } = state;
  if (!startTime || (status !== 'recording' && status !== 'paused')) return null;

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
  });
}

function activityLabel(type: string): string {
  const t = i18n.t as unknown as (key: string) => string;
  const key = `activityTypes.${type}`;
  const label = t(key);
  return label && label !== key ? label : type;
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

export function finishLiveActivity(): void {
  if (!cardRunning) return;
  cardRunning = false;
  endNativeLiveActivity();
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
 * the lock screen with a clock that never stops. Nothing else reaps it: the next
 * launch does, before any session can start a new one.
 */
export function reapOrphanedLiveActivities(): void {
  cardRunning = false;
  if (!isLiveActivitySupported()) return;
  endAllNativeLiveActivities();
}
