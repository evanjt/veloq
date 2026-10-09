/**
 * Elevation gain and loss of a recording, by the engine's rule.
 *
 * Phone GPS altitude wanders by metres from one fix to the next, so summing
 * every positive step counts that wander as climbing. The engine conditions
 * each reading by the mean of it and its neighbours and counts a rise or fall
 * only once it clears a fixed margin from the last level it counted. The live
 * tile, the review summary, the saved recording and the uploaded FIT all read
 * these figures from here, so they agree with each other and with the engine.
 */

/** A rise or fall counts once it clears this from the last counted level. */
export const ELEVATION_GAIN_HYSTERESIS_M = 3;

/** Readings in each conditioning mean: one, and its neighbour either side. */
export const ELEVATION_SMOOTHING_POINTS = 3;

/**
 * The running state, built one reading at a time.
 *
 * A reading's mean needs the reading after it, so the newest reading's mean is
 * not final. `elevationChange` counts it as the mean of the last two, which is
 * what the engine does with the last reading of a finished track, so every
 * prefix of a recording reads what the engine gives that prefix.
 */
export interface ElevationTrack {
  /** Readings that carried an altitude. */
  count: number;
  /** The reading before the last. */
  previous: number;
  /** The last reading, also the current altitude. */
  last: number;
  /** The level the next rise or fall is measured from, once two readings are in. */
  anchor: number;
  /** Gain and loss counted from final means, in metres. */
  gain: number;
  loss: number;
}

export const EMPTY_ELEVATION_TRACK: ElevationTrack = {
  count: 0,
  previous: NaN,
  last: NaN,
  anchor: NaN,
  gain: 0,
  loss: 0,
};

/** Gain and loss in metres. */
export interface ElevationTotals {
  gain: number;
  loss: number;
}

/** Count `level` against the anchor, in place. */
function settle(track: ElevationTrack, level: number): void {
  const delta = level - track.anchor;
  if (delta >= ELEVATION_GAIN_HYSTERESIS_M) {
    track.gain += delta;
    track.anchor = level;
  } else if (delta <= -ELEVATION_GAIN_HYSTERESIS_M) {
    track.loss -= delta;
    track.anchor = level;
  }
}

/** Take one reading into the track, in place. */
function take(track: ElevationTrack, altitude: number | null | undefined): void {
  if (altitude == null || !Number.isFinite(altitude)) return;
  if (track.count === 1) {
    // The first mean has no reading before it, so it is final with the second.
    track.anchor = (track.last + altitude) / 2;
  } else if (track.count > 1) {
    settle(track, (track.previous + track.last + altitude) / ELEVATION_SMOOTHING_POINTS);
  }
  track.previous = track.last;
  track.last = altitude;
  track.count += 1;
}

/** The track with one more reading. A missing or non-finite reading changes nothing. */
export function addAltitude(
  track: ElevationTrack,
  altitude: number | null | undefined
): ElevationTrack {
  if (altitude == null || !Number.isFinite(altitude)) return track;
  const next = { ...track };
  take(next, altitude);
  return next;
}

/** Gain and loss over every reading the track holds, the newest included. */
export function elevationChange(track: ElevationTrack): ElevationTotals {
  if (track.count < 2) return { gain: track.gain, loss: track.loss };
  const tail = { ...track };
  settle(tail, (track.previous + track.last) / 2);
  return { gain: tail.gain, loss: tail.loss };
}

/**
 * Gain and loss over `altitude[start..=end]`, the whole stream by default.
 * One pass with no allocation per reading, so a trim drag can replay its
 * window every frame.
 */
export function elevationOver(
  altitude: readonly (number | null | undefined)[],
  start = 0,
  end = altitude.length - 1
): ElevationTotals {
  const track = { ...EMPTY_ELEVATION_TRACK };
  const last = Math.min(end, altitude.length - 1);
  for (let i = Math.max(0, start); i <= last; i += 1) take(track, altitude[i]);
  return elevationChange(track);
}
