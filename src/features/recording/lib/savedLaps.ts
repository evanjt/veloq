import type { RecordingLap, RecordingStreams } from '../types';
import { pausedSecondsBetween, type PauseInterval } from './pausedTime';

/**
 * Mean of the observations in a lap. Heart rate and cadence record a missing
 * reading as zero, which is no observation; power records it as null, so a
 * 0 W reading counts when `zeroIsReading` is set. NaN is never an observation.
 */
function average(
  values: readonly (number | null)[] | undefined,
  start: number,
  end: number,
  zeroIsReading = false
): number | null {
  let total = 0;
  let count = 0;
  for (let i = start; i <= end; i++) {
    const value = values?.[i];
    if (value != null && Number.isFinite(value) && (zeroIsReading ? value >= 0 : value > 0)) {
      total += value;
      count++;
    }
  }
  return count ? total / count : null;
}

/**
 * A lap's distance and averages over its samples `startIndex..endIndex`, with
 * speed over the moving time since `movingStart`. The one place a lap is
 * summarised, for the Lap press and for the saved file alike.
 */
export function summariseLap(
  streams: RecordingStreams,
  bounds: Pick<
    RecordingLap,
    'index' | 'startTime' | 'endTime' | 'startIndex' | 'endIndex' | 'movingEndTime'
  >,
  movingStart: number
): RecordingLap {
  const { startIndex, endIndex } = bounds;
  const distance =
    endIndex >= startIndex
      ? Math.max(0, (streams.distance?.[endIndex] ?? 0) - (streams.distance?.[startIndex - 1] ?? 0))
      : 0;
  const duration = Math.max(0, bounds.movingEndTime - movingStart);
  return {
    ...bounds,
    distance,
    avgSpeed: duration > 0 ? distance / duration : 0,
    avgHeartrate: average(streams.heartrate, startIndex, endIndex),
    avgPower: average(streams.power, startIndex, endIndex, true),
    avgCadence: average(streams.cadence, startIndex, endIndex),
  };
}

/**
 * Store laps moved onto the saved window: the same time origin, distance
 * origin and sample indices as the saved streams. `streams` are the saved
 * streams, already rebased to zero, `timeBase` is the store time of their
 * first sample and `trimStartIndex` its store index. A lap outside the window
 * is dropped and one crossing its edge is clipped to it.
 */
export function rebaseLaps(
  laps: RecordingLap[],
  streams: RecordingStreams,
  timeBase: number,
  trimStartIndex: number,
  pauseIntervals: readonly PauseInterval[]
): RecordingLap[] {
  const end = timeBase + (streams.time.at(-1) ?? 0);
  const movingAt = (time: number) =>
    Math.max(0, time - timeBase - pausedSecondsBetween(pauseIntervals, timeBase, time));
  const saved: RecordingLap[] = [];
  for (const lap of laps) {
    const startTime = Math.max(timeBase, lap.startTime);
    const endTime = Math.min(end, lap.endTime);
    if (endTime <= startTime) continue;
    saved.push(
      summariseLap(
        streams,
        {
          index: saved.length,
          startTime: startTime - timeBase,
          endTime: endTime - timeBase,
          startIndex: Math.max(0, lap.startIndex - trimStartIndex),
          endIndex: Math.min(streams.time.length - 1, lap.endIndex - trimStartIndex),
          movingEndTime: movingAt(endTime),
        },
        movingAt(startTime)
      )
    );
  }
  return saved;
}
