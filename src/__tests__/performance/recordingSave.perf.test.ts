/**
 * Bench: saving a long ride builds the FIT file on the JS thread, behind the
 * Save spinner, and a one-shot tap is allowed 200 ms.
 *
 * Reports how long a three-hour ride takes to build on this machine and
 * asserts only that the file was built, since a timing measures the machine
 * as much as the code and several sessions share it. Collected only under
 * `npm run test:perf`.
 */

import { generateFitFile } from '@/features/recording/lib/fitGenerator';
import type { RecordingStreams } from '@/features/recording/types';

const THREE_HOURS_SECONDS = 3 * 60 * 60;

function buildStreams(samples: number): RecordingStreams {
  const streams: RecordingStreams = {
    time: [],
    latlng: [],
    altitude: [],
    heartrate: [],
    power: [],
    cadence: [],
    speed: [],
    distance: [],
  };
  for (let i = 0; i < samples; i++) {
    streams.time.push(i);
    streams.latlng.push([46.5 + i * 0.00001, 6.6 + i * 0.00001]);
    streams.altitude.push(400 + (i % 200));
    streams.heartrate.push(140 + (i % 20));
    streams.power.push(220 + (i % 60));
    streams.cadence.push(85 + (i % 10));
    streams.speed.push(8 + (i % 5));
    streams.distance.push(i * 8);
  }
  return streams;
}

describe('recording save cost', () => {
  it('times building a three-hour ride', async () => {
    const streams = buildStreams(THREE_HOURS_SECONDS);

    const buildStart = performance.now();
    const buffer = await generateFitFile({
      activityType: 'Ride',
      startTime: new Date('2026-09-12T06:00:00Z'),
      streams,
      laps: [],
    });
    const buildMs = performance.now() - buildStart;

    process.stderr.write(
      `FIT ${(buffer.byteLength / 1024).toFixed(0)} KB: build ${buildMs.toFixed(1)} ms\n`
    );

    expect(buffer.byteLength).toBeGreaterThan(100 * 1024);
  });
});
