import { recordings, type FfiRecordingFit } from 'veloqrs';
import { present } from 'veloqrs/src/delegates/optional';

import { withClosingLap } from './savedLaps';
import type { ActivityType, RecordingLap, RecordingStreams } from '@/types';

/**
 * The saved recording as the engine's FIT writer takes it. A fix that is
 * missing from the store crosses as NaN, which the writer reads as no fix.
 */
function toFfiRecording(params: {
  activityType: ActivityType;
  startTime: Date;
  streams: RecordingStreams;
  laps: readonly RecordingLap[];
  pausedTimeSeconds: number;
}): FfiRecordingFit {
  const { streams } = params;
  return {
    activityType: params.activityType,
    startUnixMillis: params.startTime.getTime(),
    pausedSeconds: params.pausedTimeSeconds,
    streams: {
      time: streams.time,
      latitude: streams.time.map((_, i) => streams.latlng[i]?.[0] ?? NaN),
      longitude: streams.time.map((_, i) => streams.latlng[i]?.[1] ?? NaN),
      altitude: streams.altitude ?? [],
      heartrate: streams.heartrate ?? [],
      power: (streams.power ?? []).map((watts) => watts ?? undefined),
      cadence: streams.cadence ?? [],
      speed: streams.speed ?? [],
      distance: streams.distance ?? [],
    },
    laps: params.laps.map((lap) =>
      present({
        startTime: lap.startTime,
        endTime: lap.endTime,
        movingEndTime: lap.movingEndTime,
        distance: lap.distance,
        avgSpeed: lap.avgSpeed,
        avgHeartrate: lap.avgHeartrate ?? undefined,
        avgPower: lap.avgPower ?? undefined,
        avgCadence: lap.avgCadence ?? undefined,
      })
    ),
  };
}

/**
 * The FIT file of a recording, written by the engine. `laps` are the laps the
 * athlete pressed, on the saved window's clock and indices; the closing lap is
 * added here, from the last press to the end of the ride.
 */
export function writeRecordingFit(params: {
  activityType: ActivityType;
  startTime: Date;
  streams: RecordingStreams;
  laps: readonly RecordingLap[];
  /** Total paused seconds, which the timer time leaves out. */
  pausedTimeSeconds?: number;
}): ArrayBuffer {
  const pausedTimeSeconds = params.pausedTimeSeconds ?? 0;
  return recordings.writeRecordingFit(
    toFfiRecording({
      ...params,
      pausedTimeSeconds,
      laps: withClosingLap(params.streams, params.laps, pausedTimeSeconds),
    })
  );
}
