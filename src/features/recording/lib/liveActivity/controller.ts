import { formatDistance, formatPace, formatSpeed } from '@/shared/format/format';
import { getIsMetric } from '@/shared/app/UnitPreferenceStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { getSportCategory } from '@/features/recording/lib/sportCategoryDetector';
import type { RecordingGpsPoint } from '@/features/recording/types';

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
  sportCategory: string;
}

let cardRunning = false;

/**
 * The paused clock the store keeps is closed only on resume, so a card built
 * mid-pause has to add the pause it is standing in.
 */
function pausedMs(now: number): number {
  const { pausedDuration, status, _pauseStart } = useRecordingStore.getState();
  if (status !== 'paused' || !_pauseStart) return pausedDuration;
  return pausedDuration + Math.max(0, now - _pauseStart);
}

/** The store keeps latlng pairs; the trace projector wants fixes. */
function traceFixes(): RecordingGpsPoint[] {
  return useRecordingStore.getState().streams.latlng.map(([latitude, longitude]) => ({
    latitude,
    longitude,
    altitude: null,
    accuracy: null,
    speed: null,
    heading: null,
    timestamp: 0,
  }));
}

function composeState(now: number): LiveActivityContentState | null {
  const { status, startTime, activityType, streams } = useRecordingStore.getState();
  if (!startTime || (status !== 'recording' && status !== 'paused')) return null;

  const isMetric = getIsMetric();
  const distance = streams.distance[streams.distance.length - 1] ?? 0;
  const paused = pausedMs(now);
  const movingS = Math.max(1, (now - startTime - paused) / 1000);
  const avgSpeed = distance / movingS;
  const category = getSportCategory(activityType ?? 'Ride');

  return buildContentState({
    status,
    now,
    startTime,
    pausedDurationMs: paused,
    distanceLabel: formatDistance(distance, isMetric),
    speedLabel:
      category === 'cycling' ? formatSpeed(avgSpeed, isMetric) : formatPace(avgSpeed, isMetric),
    gps: traceFixes(),
  });
}

/** Start the card for the session in flight. A second call is a no-op, not a second card. */
export function beginLiveActivity(): void {
  if (cardRunning || !isLiveActivitySupported()) return;
  const state = composeState(Date.now());
  if (!state) return;

  const { activityType } = useRecordingStore.getState();
  const attributes: LiveActivityAttributes = {
    activityType: activityType ?? 'Ride',
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
    const { status, pauseRecording, resumeRecording } = useRecordingStore.getState();
    if (status !== 'recording' && status !== 'paused') return;
    const wantsPause = action === 'pause' || (action === 'toggle' && status === 'recording');
    if (wantsPause) pauseRecording();
    else resumeRecording();
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
