import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { createAutoPauseDetector, type AutoPauseDetector } from './autoPause';
import {
  DEFAULT_AUTO_PAUSE_KMH,
  autoPauseCategory,
} from '@/shared/recording/sportCategoryDetector';

/**
 * The session's auto-pause detector, held here rather than in the session so
 * the notification, the Live Activity and a headless location batch, which the
 * session imports, can reach it without an import cycle.
 */
let detector: AutoPauseDetector | null = null;

export function setAutoPauseDetector(next: AutoPauseDetector | null): void {
  detector = next;
}

export function autoPauseDetector(): AutoPauseDetector | null {
  return detector;
}

/**
 * A detector from the rider's preferences, starting in the pause it took
 * itself when the store is paused by auto-pause, so a ride restored or a
 * preference changed mid-stop still resumes when the rider sets off. A
 * disabled detector never resumes, so with auto-pause off the reason is
 * cleared and the pause becomes the rider's, ended by Resume.
 */
export function buildAutoPauseDetector(): AutoPauseDetector {
  const { autoPauseEnabled, autoPauseThresholds, autoPauseDurationMs } =
    useRecordingPreferences.getState();
  if (!autoPauseEnabled && useRecordingLiveStore.getState().autoPaused) {
    useRecordingLiveStore.getState().setAutoPaused(false);
  }
  const { activityType, status } = useRecordingStore.getState();
  const sportCategory = autoPauseCategory(activityType ?? 'Ride');
  return createAutoPauseDetector(
    {
      enabled: autoPauseEnabled,
      // Preferences are km/h, the detector is m/s.
      speedThreshold:
        (autoPauseThresholds[sportCategory] ?? DEFAULT_AUTO_PAUSE_KMH[sportCategory]) / 3.6,
      durationThreshold: autoPauseDurationMs,
    },
    { paused: status === 'paused' && useRecordingLiveStore.getState().autoPaused }
  );
}

/**
 * Feed the latest raw speed to the detector and apply what it decides, at the
 * time of the fixes that decided it. A batch can be handled well after its
 * fixes were taken, and stamping it then would put ridden points in a pause.
 */
export function evaluateAutoPause(): void {
  const { status, mode, rawSpeed, pauseRecording, resumeRecording } = useRecordingStore.getState();
  if (mode !== 'gps' || !detector || !rawSpeed) return;
  if (status !== 'recording' && status !== 'paused') return;

  const result = detector.update(rawSpeed.value, rawSpeed.at);
  // The reason is set before the status, because the status change writes the
  // backup and the backup carries the reason.
  const live = useRecordingLiveStore.getState();
  if (result === 'pause' && status === 'recording') {
    live.setAutoPaused(true);
    pauseRecording(detector.stoppedSince() ?? rawSpeed.at);
  } else if (result === 'resume' && status === 'paused' && live.autoPaused) {
    live.setAutoPaused(false);
    resumeRecording(rawSpeed.at);
  }
}

/** Forget the pause the detector believes it is in, after a manual pause or resume. */
export function resetAutoPause(): void {
  detector?.reset();
  useRecordingLiveStore.getState().setAutoPaused(false);
}

/**
 * The rider's pause, from the screen, the notification or the Live Activity.
 * A pause taken by hand is not the detector's, so a later walk around cannot
 * resume it, and a resume by hand clears a flag the detector would otherwise
 * leave standing over a ride that is moving.
 */
export function pauseRecordingManually(): void {
  resetAutoPause();
  useRecordingStore.getState().pauseRecording();
}

export function resumeRecordingManually(): void {
  resetAutoPause();
  useRecordingStore.getState().resumeRecording();
}
