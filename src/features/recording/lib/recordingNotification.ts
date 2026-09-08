/**
 * The recording's half of the Android foreground-service notification.
 *
 * While the app is backgrounded the notification is the only surface the ride
 * has, and expo-location posts a fixed two-line one with no controls
 * (`backgroundLocation.ts`, `LocationTaskService.kt`). The native module
 * `VeloqRecordingNotification` re-posts onto that same notification id and
 * channel, so the service's lifecycle stays expo-location's and only the
 * content is ours. Everything here no-ops without the module, which is every
 * platform but Android.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

import { i18n } from '@/i18n';
import { brand } from '@/theme';
import { getIsMetric } from '@/shared/app/UnitPreferenceStore';
import { debug } from '@/shared/debug/debug';
import { formatDistance, formatDuration, formatSpeed } from '@/shared/format/format';
import { endRecordingSession } from '@/features/recording/lib/endRecordingSession';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import type { RecordingStatus } from '../types';

const log = debug.create('RecordingNotification');

/**
 * A notification is a thumbnail, and every point past a couple of hundred lands
 * inside a pixel already drawn. The cap keeps the payload that crosses the
 * bridge on every batch small enough not to matter.
 */
export const TRACE_POINT_CAP = 160;

export type RecordingNotificationAction = 'pause' | 'resume' | 'lap' | 'stop';

export interface RecordingNotificationPayload {
  status: 'recording' | 'paused';
  title: string;
  body: string;
  /**
   * The ride this notification belongs to, which is the store's `startTime`.
   * It rides on every button's intent so a press queued against a session that
   * has ended is not replayed into the next one.
   */
  session: number;
  /**
   * Epoch ms the chronometer counts up from. Android ticks it itself, so a
   * suspended process still shows a moving clock. Paused time is taken off the
   * base or it would count time the ride did not spend moving.
   */
  chronometerBase: number;
  /** Frozen elapsed text, for the paused state where the chronometer is off. */
  elapsedText: string;
  running: boolean;
  actions: { id: RecordingNotificationAction; label: string }[];
  /** The trace is rasterised natively, which has no access to the token file. */
  traceColor: string;
  /** Flat lat,lng pairs, decimated to at most `TRACE_POINT_CAP` points. */
  trace: number[];
}

interface VeloqRecordingNotificationModule {
  update(json: string): void;
  clear(): void;
  addListener(
    event: string,
    listener: (payload: { action: string; session?: number }) => void
  ): { remove(): void };
  /**
   * Actions that arrived while no JS runtime was listening, oldest first. The
   * receiver persists them because a notification button can outlive the
   * runtime that drew the notification.
   */
  drainPendingActions(): string[];
}

const VeloqRecordingNotification = requireOptionalNativeModule<VeloqRecordingNotificationModule>(
  'VeloqRecordingNotification'
);

/** Flatten `[lat, lng]` pairs, keeping the first and last point of a long trace. */
export function decimateTrace(
  latlng: readonly (readonly [number, number])[],
  cap = TRACE_POINT_CAP
): number[] {
  if (latlng.length === 0) return [];
  const last = latlng[latlng.length - 1];
  const flat: number[] = [];
  // The terminal point is where the rider is now, so it is always drawn and the
  // stride spends the cap's other places on the points before it.
  const stride = Math.max(1, Math.ceil((latlng.length - 1) / Math.max(1, cap - 1)));
  for (let i = 0; i < latlng.length - 1; i += stride) {
    flat.push(latlng[i][0], latlng[i][1]);
  }
  flat.push(last[0], last[1]);
  return flat;
}

interface PayloadOptions {
  translate: (key: string, fallback: string) => string;
  isMetric: boolean;
  now: number;
}

type PayloadState = Pick<
  ReturnType<typeof useRecordingStore.getState>,
  'status' | 'activityType' | 'startTime' | 'pausedDuration' | 'streams'
> & { _pauseStart: number | null };

function isLive(status: RecordingStatus): status is 'recording' | 'paused' {
  return status === 'recording' || status === 'paused';
}

export function buildRecordingNotificationPayload(
  state: PayloadState,
  { translate, isMetric, now }: PayloadOptions
): RecordingNotificationPayload | null {
  const { status, startTime, streams } = state;
  if (!isLive(status) || startTime == null) return null;

  const pausedMs =
    state.pausedDuration + (status === 'paused' && state._pauseStart ? now - state._pauseStart : 0);
  const movingMs = Math.max(0, now - startTime - pausedMs);

  const last = streams.time.length - 1;
  const distance = last >= 0 ? (streams.distance[last] ?? 0) : 0;
  const movingSeconds = movingMs / 1000;
  const avgSpeed = movingSeconds > 0 ? distance / movingSeconds : 0;

  // The screen's own control bar labels, so the notification says what the app
  // says and nothing new needs translating into seventeen locales.
  const actions: RecordingNotificationPayload['actions'] = [
    status === 'recording'
      ? { id: 'pause' as const, label: translate('recording.controls.pause', 'Pause') }
      : { id: 'resume' as const, label: translate('recording.controls.resume', 'Resume') },
    { id: 'lap', label: translate('recording.controls.lap', 'Lap') },
    { id: 'stop', label: translate('recording.controls.stop', 'Stop') },
  ];

  const elapsedText = formatDuration(movingSeconds);
  return {
    status,
    session: startTime,
    title: translate('recording.backgroundNotificationTitle', 'Recording activity'),
    body: `${formatDistance(distance, isMetric)} · ${formatSpeed(avgSpeed, isMetric)}`,
    chronometerBase: now - movingMs,
    // Shown only while paused, where a running chronometer would count time the
    // ride did not spend moving.
    elapsedText: `${translate('recording.status.paused', 'Paused')} · ${elapsedText}`,
    running: status === 'recording',
    actions,
    traceColor: brand.teal,
    trace: decimateTrace(streams.latlng),
  };
}

/**
 * Drive the same transitions the recording screen's buttons drive. Stop is the
 * one that is more than a store call: it also writes the backup and goes to
 * review, so it goes through `endRecordingSession` rather than repeating them.
 *
 * `session` is the recording the press was posted for, which is the store's
 * `startTime`. The notification outlives the process that drew it, so a press
 * can be queued against a ride that is over and drained into whichever ride is
 * live at the next launch. An action that names a different session is dropped.
 * An action that names none is from a build before the stamp and is applied, so
 * an upgrade does not swallow a press already sitting in the queue.
 */
export async function applyRecordingNotificationAction(
  action: RecordingNotificationAction,
  session?: number
): Promise<void> {
  const store = useRecordingStore.getState();
  if (session !== undefined && store.startTime !== session) return;
  switch (action) {
    case 'pause':
      store.pauseRecording();
      break;
    case 'resume':
      store.resumeRecording();
      break;
    case 'lap':
      store.addLap();
      break;
    case 'stop':
      await endRecordingSession();
      break;
  }
}

/**
 * A queued line is `<session>\t<action>`. A line with no tab is from a build
 * before the stamp: it carries no session and is applied rather than dropped,
 * so an upgrade does not swallow a press already in the queue.
 */
export function parsePendingAction(line: string): { action: string; session?: number } {
  const tab = line.indexOf('\t');
  if (tab === -1) return { action: line };
  const session = Number(line.slice(0, tab));
  return {
    action: line.slice(tab + 1),
    session: Number.isFinite(session) ? session : undefined,
  };
}

function isAction(value: string): value is RecordingNotificationAction {
  return value === 'pause' || value === 'resume' || value === 'lap' || value === 'stop';
}

export function updateRecordingNotification(now = Date.now()): void {
  if (!VeloqRecordingNotification) return;
  try {
    // i18n.t is typed to a finite key union; these are plain keys at runtime.
    const t = i18n.t as unknown as (key: string, fallback: string) => string;
    const payload = buildRecordingNotificationPayload(
      useRecordingStore.getState() as PayloadState,
      { translate: (key, fallback) => t(key, fallback), isMetric: getIsMetric(), now }
    );
    if (!payload) {
      VeloqRecordingNotification.clear();
      return;
    }
    VeloqRecordingNotification.update(JSON.stringify(payload));
  } catch (e) {
    log.warn('updateRecordingNotification failed:', e);
  }
}

export function clearRecordingNotification(): void {
  if (!VeloqRecordingNotification) return;
  try {
    VeloqRecordingNotification.clear();
  } catch (e) {
    log.warn('clearRecordingNotification failed:', e);
  }
}

/**
 * Listen for the notification's buttons. A button can be pressed after the
 * runtime that drew the notification is gone, so the queue the receiver kept
 * is drained first and in order.
 */
export function installRecordingNotificationActions(): () => void {
  if (!VeloqRecordingNotification) return () => {};
  const module = VeloqRecordingNotification;
  try {
    for (const pending of module.drainPendingActions()) {
      const { action, session } = parsePendingAction(pending);
      if (isAction(action)) applyRecordingNotificationAction(action, session);
    }
  } catch (e) {
    log.warn('drainPendingActions failed:', e);
  }
  const subscription = module.addListener('onAction', ({ action, session }) => {
    if (isAction(action)) applyRecordingNotificationAction(action, session);
    updateRecordingNotification();
  });
  return () => subscription.remove();
}
