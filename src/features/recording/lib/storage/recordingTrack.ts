// Read a recording's track from the engine, which holds it from the save or
// from the launch that replayed a save whose engine write failed.

import { decodeCoords, engine } from 'veloqrs';

import { debug } from '@/shared/debug/debug';
import type { RecordingLibraryEntry } from '@/types';

const log = debug.create('Recording');

export async function readRecordingTrack(
  entry: RecordingLibraryEntry
): Promise<[number, number][]> {
  if (!entry.engineActivityId || !engine.ready) return [];
  try {
    return decodeCoords(engine.getGpsTrack(entry.engineActivityId)).map((p) => [
      p.latitude,
      p.longitude,
    ]);
  } catch (err) {
    log.warn(`Could not read the track for ${entry.id}: ${String(err)}`);
    return [];
  }
}
