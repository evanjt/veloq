/**
 * The intervals.icu write surface.
 *
 * Rust owns the transport, the rate governor, retry, the 401 classification and
 * the multipart body, which streams the FIT off the device rather than carrying
 * it through JavaScript as bytes. What is left here is the seam above it: demo
 * mode, which has no upstream account and acknowledges a write locally, and
 * turning a refused write into a throw the caller can classify.
 */

import { routeEngine, type CallOutcome, type ManualActivity } from 'veloqrs';

import { useAuthStore, DEMO_ATHLETE_ID } from '@/shared/app/AuthStore';
import type { ManualActivityData } from '@/types';

function isDemoMode(): boolean {
  const state = useAuthStore.getState();
  return state.isDemoMode || state.athleteId === DEMO_ATHLETE_ID;
}

/**
 * A write the server did not accept, carrying the outcome Rust classified.
 * `classifyUploadError` reads the outcome off this rather than guessing from
 * the message.
 */
export class UploadFailure extends Error {
  readonly outcome: CallOutcome;

  constructor(outcome: CallOutcome) {
    super(outcome.message);
    this.name = 'UploadFailure';
    this.outcome = outcome;
  }
}

/** The id of the activity the write created, when the server reported one. */
function createdId(outcome: CallOutcome): string | undefined {
  if (outcome.kind !== 'ok') throw new UploadFailure(outcome);
  return outcome.id;
}

/**
 * Upload a recorded activity file, streamed from `filePath`.
 *
 * Resolves to the created activity id, which intervals.icu does not always
 * report. An id-less success is still a success: the activity is on the server,
 * and treating it as a failure would have the queue upload the same ride twice.
 */
export async function uploadActivityFile(
  filePath: string,
  filename: string,
  opts?: { name?: string; pairedEventId?: number }
): Promise<string | undefined> {
  if (isDemoMode()) return `demo-${Date.now()}`;
  return createdId(
    await routeEngine.uploadActivityFile(filePath, filename, opts?.name, opts?.pairedEventId)
  );
}

/** Create an activity with no file behind it, for indoor entries. */
export async function createManualActivity(data: ManualActivityData): Promise<string | undefined> {
  if (isDemoMode()) return `demo-${Date.now()}`;
  return createdId(await routeEngine.createManualActivity(toManualActivity(data)));
}

/** Widen the screen's shape to the record the engine takes. */
function toManualActivity(data: ManualActivityData): ManualActivity {
  return {
    activityType: data.type,
    name: data.name,
    startDateLocal: data.start_date_local,
    elapsedTime: BigInt(Math.round(data.elapsed_time)),
    movingTime: data.moving_time === undefined ? undefined : BigInt(Math.round(data.moving_time)),
    distance: data.distance,
    totalElevationGain: data.total_elevation_gain,
    averageHeartrate: data.average_heartrate,
    description: data.description,
    trainer: data.trainer,
    commute: data.commute,
  };
}
