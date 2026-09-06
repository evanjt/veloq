/**
 * The track of a saved recording, as `[lat, lng]` pairs.
 *
 * The engine holds it from the save, so the streams sidecar is only there for
 * a recording whose engine write did not land. An uploaded recording has no
 * sidecar left.
 */

import { engine } from 'veloqrs';

import { debug } from '@/shared/debug/debug';
import { readRecordingStreams } from '@/features/recording/lib/storage/recordingLibrary';
import type { RecordingLibraryEntry } from '@/types';

const log = debug.create('Recording');

export async function readRecordingTrack(
  entry: RecordingLibraryEntry
): Promise<[number, number][]> {
  if (entry.engineActivityId && engine.ready) {
    try {
      const points = engine.getGpsTrack(entry.engineActivityId);
      if (points.length > 0) {
        return points.map((p) => [p.latitude, p.longitude]);
      }
    } catch (err) {
      log.warn(`Could not read the track for ${entry.id}: ${String(err)}`);
      return [];
    }
  }
  return (await readRecordingStreams(entry))?.latlng ?? [];
}
