// Read the engine track, falling back to the sidecar kept until confirmation.

import { decodeCoords, engine } from 'veloqrs';

import { debug } from '@/shared/debug/debug';
import { readRecordingStreams } from '@/features/recording/lib/storage/recordingLibrary';
import type { RecordingLibraryEntry } from '@/types';

const log = debug.create('Recording');

export async function readRecordingTrack(
  entry: RecordingLibraryEntry
): Promise<[number, number][]> {
  if (entry.engineActivityId && engine.ready) {
    try {
      const points = decodeCoords(engine.getGpsTrack(entry.engineActivityId));
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
