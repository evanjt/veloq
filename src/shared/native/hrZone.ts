import { getEngine } from './engine';

/**
 * The heart rate zone, numbered from 1, that a live reading falls in for a
 * sport type, as the engine classifies it from the athlete's own zones. Null
 * when the engine is not open, has no zone for the reading, or could not read
 * the zones. The zone only tints a tile on the recording screen, read every
 * second, so a failed read leaves the tile untinted rather than ending the
 * recording screen.
 */
export function engineHrZone(sportType: string, bpm: number): number | null {
  try {
    return getEngine()?.hrZoneFor(sportType, bpm) ?? null;
  } catch {
    return null;
  }
}
