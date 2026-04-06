import { generateFitFile } from '@/lib/recording/fitGenerator';
import type { RecordingStreams } from '@/types';

/**
 * Golden file test for FIT binary format.
 * Detects silent encoding regressions by comparing output byte-for-byte.
 * If this test fails, the FIT encoding has changed — verify the change is intentional.
 */
describe('FIT golden file', () => {
  const FROZEN_INPUT = {
    activityType: 'Ride' as const,
    startTime: new Date('2026-01-15T10:00:00Z'),
    streams: {
      time: [0, 5, 10, 15, 20],
      latlng: [
        [46.948, 7.447],
        [46.949, 7.448],
        [46.95, 7.449],
        [46.951, 7.45],
        [46.952, 7.451],
      ] as [number, number][],
      altitude: [540, 542, 545, 543, 541],
      heartrate: [120, 135, 150, 145, 130],
      power: [180, 220, 260, 240, 200],
      cadence: [85, 88, 92, 90, 86],
      speed: [7.5, 8.0, 8.5, 8.2, 7.8],
      distance: [0, 40, 82.5, 123.5, 162.5],
    } as RecordingStreams,
    laps: [],
  };

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  it('produces deterministic binary output', async () => {
    const buffer = await generateFitFile(FROZEN_INPUT);
    const base64 = arrayBufferToBase64(buffer);

    // Generate twice to verify determinism
    const buffer2 = await generateFitFile(FROZEN_INPUT);
    const base642 = arrayBufferToBase64(buffer2);

    expect(base64).toBe(base642);
  });

  it('output matches golden snapshot', async () => {
    const buffer = await generateFitFile(FROZEN_INPUT);
    const base64 = arrayBufferToBase64(buffer);

    // To update: delete the snapshot file and re-run tests
    // console.log('GOLDEN:', base64);
    expect(base64).toMatchSnapshot();
  });
});
