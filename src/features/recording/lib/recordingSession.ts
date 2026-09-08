import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';

import { i18n } from '@/i18n';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { debug } from '@/shared/debug/debug';
import { startBackgroundLocation, stopBackgroundLocation } from './backgroundLocation';
import {
  clearRecordingNotification,
  installRecordingNotificationActions,
  updateRecordingNotification,
} from './recordingNotification';
import { getGpsWatchOptions, getAccuracyRejectThreshold } from './gpsConfig';
import { createAutoPauseDetector, type AutoPauseConfig } from './autoPause';
import { getSportCategory } from './sportCategoryDetector';
import { buildRecordingBackup, saveRecordingBackup } from './storage/recordingBackup';
import { BACKUP_INTERVAL_MS, LIVE_ACTIVITY_REFRESH_MS } from './constants';
import {
  beginLiveActivity,
  finishLiveActivity,
  installLiveActivityControls,
  reapOrphanedLiveActivities,
  refreshLiveActivity,
} from './liveActivity/controller';
import type { RecordingStatus } from '../types';

const log = debug.create('RecordingSession');

type Timer = ReturnType<typeof setInterval>;
type AutoPauseDetector = ReturnType<typeof createAutoPauseDetector>;

let watch: Location.LocationSubscription | null = null;
let appStateSub: { remove: () => void } | null = null;
let appState: AppStateStatus = 'active';
let indoorTimer: Timer | null = null;
let backupTimer: Timer | null = null;
let liveActivityTimer: Timer | null = null;
let backupArmedFor: string | null = null;
let detector: AutoPauseDetector | null = null;
let sessionUnsubscribes: (() => void)[] = [];
let installUnsubscribe: (() => void) | null = null;
let running = false;

function isLive(status: RecordingStatus): boolean {
  return status === 'recording' || status === 'paused';
}

function buildDetector(): AutoPauseDetector {
  const { autoPauseEnabled, autoPauseThresholds, autoPauseDurationMs } =
    useRecordingPreferences.getState();
  const { activityType } = useRecordingStore.getState();
  const sportCategory = getSportCategory(activityType ?? 'Ride');
  return createAutoPauseDetector({
    enabled: autoPauseEnabled,
    // Preferences are km/h, the detector is m/s.
    speedThreshold: (autoPauseThresholds[sportCategory] ?? 2) / 3.6,
    durationThreshold: autoPauseDurationMs,
  } as AutoPauseConfig);
}

/** Forget the pause the detector believes it is in, after a manual pause or resume. */
export function resetAutoPause(): void {
  detector?.reset();
  useRecordingLiveStore.getState().setAutoPaused(false);
}

function evaluateAutoPause(): void {
  const { status, mode, rawSpeed, pauseRecording, resumeRecording } = useRecordingStore.getState();
  if (mode !== 'gps' || !detector || !rawSpeed || !isLive(status)) return;

  const result = detector.update(rawSpeed.value, rawSpeed.at);
  const live = useRecordingLiveStore.getState();
  if (result === 'pause' && status === 'recording') {
    pauseRecording();
    live.setAutoPaused(true);
  } else if (result === 'resume' && status === 'paused' && live.autoPaused) {
    resumeRecording();
    live.setAutoPaused(false);
  }
}

function ingestFix(coords: Location.LocationObjectCoords, timestamp: number): void {
  const { latitude, longitude, altitude, accuracy, speed, heading } = coords;
  useRecordingLiveStore.getState().setFix({ latitude, longitude }, accuracy);

  // Drop low-accuracy points to reduce GPS noise (the threshold is a preference)
  if (accuracy != null && accuracy > getAccuracyRejectThreshold()) return;

  const { addGpsPoint, setRawLocationFix, status } = useRecordingStore.getState();
  const point = { latitude, longitude, altitude, accuracy, speed, heading, timestamp };
  // Fixes keep arriving while paused. Auto-pause reads them so a ride that
  // stopped at a light can resume itself.
  setRawLocationFix(point);
  if (status === 'recording') addGpsPoint(point);
}

async function startForegroundWatch(): Promise<void> {
  if (watch) return;
  log.log('Starting foreground location watch');
  watch = await Location.watchPositionAsync(getGpsWatchOptions(), (location) => {
    ingestFix(location.coords, location.timestamp);
  });
}

function stopForegroundWatch(): void {
  if (!watch) return;
  log.log('Stopping foreground location watch');
  watch.remove();
  watch = null;
}

/**
 * Start the location watch if the permission is already granted. The session
 * never prompts: the recording screen owns the prompt, because a denial needs
 * a banner and an alert, and calls this again once the rider grants it.
 */
export async function ensureLocationWatch(): Promise<boolean> {
  if (!running) return false;
  if (useRecordingStore.getState().mode !== 'gps') return false;
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') return false;
  if (appState === 'active') {
    await startForegroundWatch();
  } else {
    await startBackgroundLocation(backgroundNotification());
  }
  return true;
}

function backgroundNotification() {
  return {
    notificationTitle: i18n.t('recording.backgroundNotificationTitle', 'Recording activity'),
    notificationBody: i18n.t(
      'recording.backgroundNotificationBody',
      'Veloq is tracking your location'
    ),
  };
}

async function handleAppStateChange(next: AppStateStatus): Promise<void> {
  const previous = appState;
  appState = next;
  if (!running || useRecordingStore.getState().mode !== 'gps') return;

  if (previous === 'active' && next.match(/inactive|background/)) {
    log.log('App backgrounded, switching to background location');
    stopForegroundWatch();
    try {
      await startBackgroundLocation(backgroundNotification());
      updateRecordingNotification();
    } catch (e) {
      log.error('Failed to start background location:', e);
    }
  } else if (previous.match(/inactive|background/) && next === 'active') {
    log.log('App foregrounded, switching to foreground location');
    try {
      await stopBackgroundLocation();
    } catch (e) {
      log.error('Failed to stop background location:', e);
    }
    await ensureLocationWatch();
  }
}

function writeBackup(): void {
  const backup = buildRecordingBackup(useRecordingStore.getState());
  if (backup) saveRecordingBackup(backup);
}

/**
 * Crash-recovery backups. Written on every status transition and on each lap,
 * plus periodically while recording, so a kill loses at most one interval.
 * The stopped-state backup is written by the stop handler; clearing happens
 * only on discard or once the recording is safely persisted.
 */
function armBackups(status: RecordingStatus, laps: number): void {
  // Zustand notifies a listener added during a notification, so the session's
  // own subscription sees the transition that started it. Arming is keyed so
  // that costs nothing rather than a duplicate write.
  const key = `${status}:${laps}`;
  if (key === backupArmedFor) return;
  backupArmedFor = key;
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
  if (!isLive(status)) return;
  writeBackup();
  if (status !== 'recording') return;
  backupTimer = setInterval(writeBackup, BACKUP_INTERVAL_MS);
}

function startSession(): void {
  if (running) return;
  running = true;
  const { status, mode, laps } = useRecordingStore.getState();
  log.log(`Starting recording session (${mode})`);

  detector = buildDetector();
  useRecordingLiveStore.getState().setAutoPaused(false);

  sessionUnsubscribes.push(
    useRecordingPreferences.subscribe(() => {
      detector = buildDetector();
    }),
    useRecordingStore.subscribe((state, previous) => {
      // Raw fixes arrive from the foreground watch and from the background
      // task, so auto-pause reads the store rather than either callback.
      if (state.rawSpeed !== previous.rawSpeed) evaluateAutoPause();
      if (state.status !== previous.status || state.laps.length !== previous.laps.length) {
        armBackups(state.status, state.laps.length);
        // Pausing swaps the button and stops the clock, so the notification is
        // wrong the moment either changes rather than at the next fix.
        updateRecordingNotification();
      }
      // A pause has to reach the card now. Waiting out the tick leaves a lock
      // screen counting up through a stop the rider has already made.
      if (state.status !== previous.status) refreshLiveActivity();
    }),
    installRecordingNotificationActions()
  );

  armBackups(status, laps.length);
  beginLiveActivity();
  liveActivityTimer = setInterval(refreshLiveActivity, LIVE_ACTIVITY_REFRESH_MS);

  if (mode === 'indoor') {
    indoorTimer = setInterval(() => useRecordingStore.getState().addIndoorSample(), 1000);
    return;
  }

  // A session only ever starts from the recording screen, so it starts in the
  // foreground and the change events carry it from there.
  appState = 'active';
  appStateSub = AppState.addEventListener('change', (next) => {
    void handleAppStateChange(next);
  });
  void ensureLocationWatch().catch((e) => log.error('Failed to start location watch:', e));
}

function stopSession(): void {
  if (!running) return;
  running = false;
  log.log('Stopping recording session');

  for (const unsubscribe of sessionUnsubscribes) unsubscribe();
  sessionUnsubscribes = [];
  detector = null;

  if (indoorTimer) {
    clearInterval(indoorTimer);
    indoorTimer = null;
  }
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
  if (liveActivityTimer) {
    clearInterval(liveActivityTimer);
    liveActivityTimer = null;
  }
  finishLiveActivity();
  backupArmedFor = null;
  appStateSub?.remove();
  appStateSub = null;

  stopForegroundWatch();
  clearRecordingNotification();
  stopBackgroundLocation().catch((e) => log.error('Failed to stop background location:', e));
  useRecordingLiveStore.getState().reset();
}

/**
 * Tie the recording session to the store rather than to the recording screen.
 * `startRecording` starts the watch, the indoor tick and the backups;
 * `stopRecording` and `reset` end them. The screen is only a viewer, so a tab
 * tap mid-ride no longer stops the GPS while the clock keeps running.
 */
export function installRecordingSession(): () => void {
  if (installUnsubscribe) return installUnsubscribe;

  const react = (status: RecordingStatus): void => {
    if (isLive(status)) startSession();
    else stopSession();
  };

  const unsubscribe = useRecordingStore.subscribe((state, previous) => {
    if (state.status !== previous.status) react(state.status);
  });
  const stopListening = installLiveActivityControls();

  installUnsubscribe = () => {
    unsubscribe();
    stopListening();
    installUnsubscribe = null;
    stopSession();
  };

  // A card outlives the process that made it, so a terminated app leaves one
  // counting on the lock screen. Reap before the restored status can start a
  // session, or the orphan and the new card sit side by side.
  reapOrphanedLiveActivities();
  react(useRecordingStore.getState().status);
  return installUnsubscribe;
}
