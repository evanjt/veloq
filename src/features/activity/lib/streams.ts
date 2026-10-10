import type { ActivityStreams } from '@/types';
import { decodeCoordsFlat } from 'veloqrs';
import type { ActivityStreamBuffers } from 'veloqrs';
import { timeAppWork } from '@/shared/debug/renderTimer';

/** The metrics row for turning stream buffers into chart arrays. */
export const DECODE_STREAMS = 'decode.streams';

/**
 * One series as a view over its little-endian float buffer, or undefined when
 * the activity has none. A buffer that is not whole samples is a corrupt read
 * and reads as absent rather than throwing in a query function. The view
 * copies nothing: a four-hour ride is 21,600 samples a series, and a boxed
 * array of them is a second copy the size of the buffer.
 */
function series(buffer: ArrayBuffer): Float64Array | undefined {
  if (buffer.byteLength === 0 || buffer.byteLength % Float64Array.BYTES_PER_ELEMENT !== 0) {
    return undefined;
  }
  return new Float64Array(buffer);
}

/**
 * The engine's chart series as the arrays the charts read. Rust has already
 * parsed the stored body, applied the coordinate index space to every series
 * and converted grade-adjusted speed to pace, so this only views the buffers.
 * The track stays flat, latitude and longitude in alternate slots, so it costs
 * no object or tuple a point until a reader builds the points it draws.
 */
export function streamsFromBuffers(buffers: ActivityStreamBuffers): ActivityStreams {
  return timeAppWork(DECODE_STREAMS, () => decodeStreams(buffers));
}

function decodeStreams(buffers: ActivityStreamBuffers): ActivityStreams {
  const streams: ActivityStreams = {};
  const latlng = decodeCoordsFlat(buffers.latlng);
  if (latlng.length > 0) streams.latlng = latlng;
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

/** The series as plain arrays, the track as `[lat, lng]` pairs. */
export type StreamArrays = {
  [K in keyof ActivityStreams]?: K extends 'latlng'
    ? readonly (readonly [number, number])[]
    : readonly number[];
};

const SERIES_KEYS = [
  'time',
  'altitude',
  'heartrate',
  'watts',
  'cadence',
  'velocity_smooth',
  'distance',
  'grade_smooth',
  'temp',
  'wbal',
  'gap',
] as const;

/**
 * Series written as plain arrays, the demo generator's, in the shape the
 * engine read returns. The track is flattened into the same alternate slots,
 * so the detail map and the charts read demo and stored streams through one
 * path. An empty series is absent, as it is from the engine.
 */
export function streamsFromArrays(arrays: StreamArrays): ActivityStreams {
  const streams: ActivityStreams = {};
  if (arrays.latlng && arrays.latlng.length > 0) {
    const latlng = new Float64Array(arrays.latlng.length * 2);
    arrays.latlng.forEach(([lat, lng], i) => {
      latlng[i * 2] = lat;
      latlng[i * 2 + 1] = lng;
    });
    streams.latlng = latlng;
  }
  for (const key of SERIES_KEYS) {
    const values = arrays[key];
    if (values && values.length > 0) streams[key] = Float64Array.from(values);
  }
  return streams;
}
