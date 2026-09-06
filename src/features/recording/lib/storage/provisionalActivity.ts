/**
 * The engine row a recording gets at save time, under a key the device minted.
 *
 * The key never moves. An upload that lands writes the intervals.icu id beside
 * it, and the sync matches on that column rather than storing the ride twice.
 */

import { engine } from 'veloqrs';

import { toActivityMetrics } from '@/features/activity';
import { debug } from '@/shared/debug/debug';
import { epochMsToStartDateLocal, startDateLocalToEpochSeconds } from '@/shared/time/startDate';
import type { Activity, RecordingLibraryEntry, RecordingStreams } from '@/types';

const log = debug.create('Recording');

/** The recording as an intervals.icu body, which is what the feed reads. */
export function buildProvisionalBody(entry: RecordingLibraryEntry, activityId: string): Activity {
  const seconds = entry.durationSeconds;
  return {
    id: activityId,
    name: entry.name,
    type: entry.activityType,
    start_date_local: epochMsToStartDateLocal(entry.startTime),
    moving_time: seconds,
    elapsed_time: seconds,
    distance: entry.distanceMeters,
    total_elevation_gain: entry.elevationGain ?? 0,
    average_speed: seconds > 0 ? entry.distanceMeters / seconds : 0,
    max_speed: 0,
    ...(entry.avgHeartrate != null ? { average_heartrate: entry.avgHeartrate } : {}),
  };
}

/**
 * Write the recording into the engine and answer the key it was written under.
 * Null when nothing was written: the FIT and the index are the durable copy,
 * so a failure here delays the ride rather than losing it.
 */
export async function writeProvisionalActivity(
  entry: RecordingLibraryEntry,
  streams: RecordingStreams | null
): Promise<string | null> {
  if (!engine.ready) {
    log.warn(`Engine not open, ${entry.id} has no row until it syncs back down`);
    return null;
  }

  const activityId = engine.mintLocalActivityId();
  if (!activityId) return null;

  try {
    const track = streams?.latlng ?? [];
    if (track.length > 0) {
      // The track starts section detection, so it goes in first.
      await engine.addActivities([activityId], track.flat(), [0], [entry.activityType]);
    }

    const body = buildProvisionalBody(entry, activityId);
    engine.upsertActivityBodies([
      {
        activityId,
        date: startDateLocalToEpochSeconds(body.start_date_local) ?? 0,
        raw: JSON.stringify(body),
      },
    ]);
    engine.setActivityMetrics([toActivityMetrics(body)]);
    log.log(`Provisional row ${activityId} for recording ${entry.id}`);
    return activityId;
  } catch (err) {
    log.warn(`Could not write a provisional row for ${entry.id}: ${String(err)}`);
    return null;
  }
}

/**
 * Write the id intervals.icu gave the ride onto its provisional row. Without
 * it the next sync stores the ride again under the server's own key.
 */
export function recordProvisionalUpload(
  entry: RecordingLibraryEntry,
  intervalsActivityId: string | undefined
): void {
  if (!entry.engineActivityId || !intervalsActivityId) return;
  try {
    engine.recordActivityUpload(entry.engineActivityId, intervalsActivityId);
  } catch (err) {
    log.warn(`Could not record the upload of ${entry.id}: ${String(err)}`);
  }
}
