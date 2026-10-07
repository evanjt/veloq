/**
 * The intervals.icu write surface.
 *
 * Rust owns the transport, the rate governor, retry, the 401 classification,
 * the multipart body and the whole upload of a recording, which it runs on its
 * own schedule and on the athlete's word alike. What is left here is the seam
 * above it: demo mode, which has no upstream account and acknowledges a write
 * locally, and turning a refused write into a throw.
 */

import { CallKind, UploadOutcome, engine, type CallOutcome, type UploadResult } from 'veloqrs';

import { useAuthStore, DEMO_ATHLETE_ID } from '@/shared/app/AuthStore';
import {
  recordingInstall,
  transitionRecording,
} from '@/features/recording/lib/storage/recordingLibrary';

function isDemoMode(): boolean {
  const state = useAuthStore.getState();
  return state.isDemoMode || state.athleteId === DEMO_ATHLETE_ID;
}

/** A write the server did not accept, carrying the outcome Rust classified. */
export class UploadFailure extends Error {
  readonly outcome: CallOutcome;

  constructor(outcome: CallOutcome) {
    super(outcome.message);
    this.name = 'UploadFailure';
    this.outcome = outcome;
  }
}

/** Throw when the server did not accept the call. */
function accepted(outcome: CallOutcome): void {
  if (outcome.kind !== CallKind.Ok) throw new UploadFailure(outcome);
}

/**
 * Upload one recording now, for the review save and Upload now, and answer how
 * it ended. The engine runs the same sequence its schedule runs for a due ride,
 * with a parked ride requeued first because the athlete asked for it.
 *
 * Demo mode has no account to send to, so the ride is marked uploaded under a
 * local id and nothing leaves the device.
 */
export async function uploadRecordingNow(id: string): Promise<UploadResult> {
  if (isDemoMode()) {
    const answer = await transitionRecording(id, {
      kind: 'uploaded',
      install: recordingInstall(),
      intervalsActivityId: `demo-${Date.now()}`,
    });
    return { outcome: answer.applied ? UploadOutcome.Uploaded : UploadOutcome.NotStarted };
  }
  return engine.uploadRecording(id, true);
}

/**
 * Set the effort the athlete gave an uploaded activity, as its `icu_rpe`.
 * Throws an `UploadFailure` when the server did not take it.
 */
export async function updateActivityRpe(intervalsId: string, rpe: number): Promise<void> {
  if (isDemoMode()) return;
  accepted(await engine.updateActivityRpe(intervalsId, rpe));
}
