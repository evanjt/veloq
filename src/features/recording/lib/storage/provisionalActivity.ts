/**
 * The engine row a recording gets at save time, under a key the device minted.
 *
 * The key never moves. An upload that lands writes the intervals.icu id beside
 * it, and the sync matches on that column rather than storing the ride twice.
 */

import { engine } from 'veloqrs';

import { debug } from '@/shared/debug/debug';
import { getStoredCredentials } from '@/shared/app/AuthStore';
import { epochMsToStartDateLocal, startDateLocalToEpochSeconds } from '@/shared/time/startDate';
import {
  attachEngineActivity,
  listRecordings,
} from '@/features/recording/lib/storage/recordingLibrary';
import type { Activity, RecordingLibraryEntry } from '@/types';

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
    ...(entry.notes ? { description: entry.notes } : {}),
    ...(entry.rpe != null ? { icu_rpe: entry.rpe } : {}),
  };
}

/**
 * Write the recording into the engine and answer the key it was written under.
 * Null when nothing was written: the FIT and the index are the durable copy,
 * so a failure here delays the ride rather than losing it, and
 * `replayProvisionalWrites` tries again at the next launch.
 *
 * The engine reads the track out of the ride's FIT itself. A manual entry has
 * no file and gets a row with no track.
 */
export async function writeProvisionalActivity(
  entry: RecordingLibraryEntry
): Promise<string | null> {
  if (!engine.ready) {
    log.warn(`Engine not open, ${entry.id} has no row until it syncs back down`);
    return null;
  }

  const activityId = entry.engineActivityId ?? engine.provisionalActivityId(entry.id);
  if (!activityId) return null;

  try {
    const body = buildProvisionalBody(entry, activityId);
    const fitPath = entry.kind === 'fit' && entry.fitPath ? entry.fitPath : undefined;
    const saved = await engine.saveProvisionalActivity(activityId, fitPath, {
      activityId,
      date: startDateLocalToEpochSeconds(body.start_date_local) ?? 0,
      raw: JSON.stringify(body),
    });
    if (!saved) return null;
    log.log(`Provisional row ${activityId} for recording ${entry.id}`);
    return activityId;
  } catch (err) {
    log.warn(`Could not write a provisional row for ${entry.id}: ${String(err)}`);
    return null;
  }
}

/**
 * Write the engine row for every recording whose save never got one, and
 * answer how many were written.
 *
 * A save whose engine write failed, or that ran with the engine closed, left a
 * ride the feed, the week and section detection cannot see until it uploads
 * and syncs back. This runs once per engine open and writes the row from the
 * ride's own FIT, which the engine reads on its worker. A ride whose upload
 * already landed gets that id on the row too, or the next sync would store it
 * again. One that fails again waits for the next launch.
 *
 * An entry marked uploaded with no id is skipped: no id can ever reach its row,
 * and the sync brings the server's copy. So is a ride stamped with an athlete
 * other than the one signed in, since the open library is not theirs. An
 * unstamped one predates the stamp and is written, as it would be uploaded.
 */
export async function replayProvisionalWrites(): Promise<number> {
  if (!engine.ready) return 0;
  const signedIn = getStoredCredentials().athleteId;
  const owed = (await listRecordings()).filter(
    (entry) =>
      !entry.engineActivityId &&
      (!entry.athleteId || entry.athleteId === signedIn) &&
      (entry.uploadStatus !== 'uploaded' || !!entry.intervalsActivityId)
  );
  let written = 0;
  for (const entry of owed) {
    const engineActivityId = await writeProvisionalActivity(entry);
    if (!engineActivityId) continue;
    written += 1;
    await attachEngineActivity(entry.id, engineActivityId);
  }
  if (written > 0) log.log(`Wrote ${written} engine row(s) a save had missed`);
  return written;
}
