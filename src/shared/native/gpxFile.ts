import type { GpsPoint, GpxFile } from 'veloqrs';
import { getEngine } from './engine';

/**
 * The GPX file for one shared track, written by the engine with the athlete's
 * export privacy trim applied. Null when the trim leaves too little to be a
 * track. Throws when the engine is not open, since sharing the untrimmed track
 * would ignore the setting.
 */
export function buildGpxFile(
  name: string,
  sport: string | undefined,
  time: string | undefined,
  points: GpsPoint[]
): GpxFile | null {
  const engine = getEngine();
  if (!engine) throw new Error('Engine not available');
  return engine.buildGpxFile(name, sport, time, points);
}
