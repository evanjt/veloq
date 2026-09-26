/**
 * Scenario: saving a long ride builds the FIT file and its base64 on the JS
 * thread, behind the Save spinner.
 *
 * Expected behaviour: a three-hour ride stays well inside the 200 ms a
 * one-shot tap is allowed, so neither step needs moving off the thread.
 *
 * Collected only under `npm run test:perf`, because a wall-clock assertion
 * measures the machine as much as the code.
 */

import { generateFitFile } from '@/features/recording/lib/fitGenerator';
import { bufferToBase64 } from '@/features/recording/lib/storage/recordingLibrary';
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
  it('builds and encodes a three-hour ride inside a one-shot tap budget', async () => {
    const streams = buildStreams(THREE_HOURS_SECONDS);

    const buildStart = performance.now();
    const buffer = await generateFitFile({
      activityType: 'Ride',
      startTime: new Date('2026-09-12T06:00:00Z'),
      streams,
      laps: [],
    });
    const buildMs = performance.now() - buildStart;

    const encodeStart = performance.now();
    const base64 = bufferToBase64(buffer);
    const encodeMs = performance.now() - encodeStart;

    console.log(
      `FIT ${(buffer.byteLength / 1024).toFixed(0)} KB: build ${buildMs.toFixed(1)} ms, ` +
        `base64 ${encodeMs.toFixed(1)} ms, ${(base64.length / 1024).toFixed(0)} KB encoded`
    );

    expect(buffer.byteLength).toBeGreaterThan(100 * 1024);
    expect(buildMs + encodeMs).toBeLessThan(200);
  });
});
