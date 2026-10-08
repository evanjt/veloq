/**
 * Builds what `getActivityStreams` hands across the bridge, so a test can feed
 * the real reader the buffers a native read returns. A series left out is the
 * empty buffer the engine sends for an activity that lacks it.
 */
import type { ActivityStreamBuffers } from 'veloqrs';

export interface StreamSeries {
  time?: number[];
  altitude?: number[];
  heartrate?: number[];
  watts?: number[];
  cadence?: number[];
  velocitySmooth?: number[];
  distance?: number[];
  gradeSmooth?: number[];
  temp?: number[];
  wbal?: number[];
  gap?: number[];
  /** Bytes in the engine's track encoding, as `encodeTrack` writes them. */
  latlng?: ArrayBuffer;
}

function floats(values: number[] | undefined): ArrayBuffer {
  const view = new DataView(new ArrayBuffer((values?.length ?? 0) * 8));
  values?.forEach((v, i) => view.setFloat64(i * 8, v, true));
  return view.buffer as ArrayBuffer;
}

export function streamBuffers(series: StreamSeries = {}): ActivityStreamBuffers {
  return {
    latlng: series.latlng ?? new ArrayBuffer(0),
    time: floats(series.time),
    altitude: floats(series.altitude),
    heartrate: floats(series.heartrate),
    watts: floats(series.watts),
    cadence: floats(series.cadence),
    velocitySmooth: floats(series.velocitySmooth),
    distance: floats(series.distance),
    gradeSmooth: floats(series.gradeSmooth),
    temp: floats(series.temp),
    wbal: floats(series.wbal),
    gap: floats(series.gap),
  };
}
