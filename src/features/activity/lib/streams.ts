import type { ActivityStreams } from '@/types';
import { decodeCoords } from 'veloqrs';
import type { ActivityStreamBuffers } from 'veloqrs';

/**
 * One series from its little-endian float buffer, or undefined when the
 * activity has none. A buffer that is not whole samples is a corrupt read and
 * reads as absent rather than throwing in a query function.
 */
function series(buffer: ArrayBuffer): number[] | undefined {
  if (buffer.byteLength === 0 || buffer.byteLength % Float64Array.BYTES_PER_ELEMENT !== 0) {
    return undefined;
  }
  return Array.from(new Float64Array(buffer));
}

/**
 * The engine's chart series as the arrays the charts read. Rust has already
 * parsed the stored body, applied the coordinate index space to every series
 * and converted grade-adjusted speed to pace, so this only views the buffers.
 */
export function streamsFromBuffers(buffers: ActivityStreamBuffers): ActivityStreams {
  const streams: ActivityStreams = {};
  const points = decodeCoords(buffers.latlng);
  if (points.length > 0) {
    streams.latlng = points.map((p) => [p.latitude, p.longitude]);
  }
  const named = {
    time: buffers.time,
    altitude: buffers.altitude,
    heartrate: buffers.heartrate,
    watts: buffers.watts,
    cadence: buffers.cadence,
    velocity_smooth: buffers.velocitySmooth,
    distance: buffers.distance,
    grade_smooth: buffers.gradeSmooth,
    temp: buffers.temp,
    wbal: buffers.wbal,
    gap: buffers.gap,
  } as const;
  for (const key of Object.keys(named) as (keyof typeof named)[]) {
    const values = series(named[key]);
    if (values) streams[key] = values;
  }
  return streams;
}
