/**
 * Scenario: an engine row in the Developer Dashboard times the call and the
 * lift, and the decoding a screen does afterwards, parsing bodies, viewing
 * stream buffers, decoding preview tracks, falls outside every row.
 * Expected behaviour: each decoding step records its own row while Debug Mode
 * is on, returns what it decoded, and records nothing while it is off.
 */

import { parseBodies, DECODE_ACTIVITY_BODIES } from '@/shared/native/storedActivities';
import { DECODE_STREAMS, streamsFromBuffers } from '@/features/activity/lib/streams';
import { buildPreviewTracks, DECODE_PREVIEW_TRACKS } from '@/features/home/hooks/useStartupData';
import {
  clearFFIMetrics,
  getFFIMetrics,
  setAppMetricsEnabled,
  timeAppWork,
} from '@/shared/debug/renderTimer';
import { streamBuffers } from '../__shared__/streamBuffers';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [{ latitude: 46.2, longitude: 7.36 }],
  })
);

const rows = (name: string) => getFFIMetrics().filter((entry) => entry.name === name);

beforeEach(() => {
  clearFFIMetrics();
  setAppMetricsEnabled(true);
});

afterEach(() => setAppMetricsEnabled(false));

describe('timeAppWork', () => {
  it('returns the work and records one row under its name', () => {
    expect(timeAppWork('decode.sample', () => 42)).toBe(42);
    const recorded = rows('decode.sample');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records nothing while Debug Mode is off', () => {
    setAppMetricsEnabled(false);
    expect(timeAppWork('decode.sample', () => 'done')).toBe('done');
    expect(getFFIMetrics()).toEqual([]);
  });

  it('records a row for work that throws, and rethrows', () => {
    expect(() =>
      timeAppWork('decode.sample', () => {
        throw new Error('corrupt');
      })
    ).toThrow('corrupt');
    expect(rows('decode.sample')).toHaveLength(1);
  });
});

describe('the decoding after an engine read', () => {
  it('times parsing the stored activity bodies', () => {
    const parsed = parseBodies({
      bodies: ['{"id":"i1"}', 'not json', '{"id":"i2"}'],
      intervalsIds: [],
      keys: ['i1', 'k2', 'i2'],
    });
    expect(parsed.map((activity) => activity.id)).toEqual(['i1', 'i2']);
    expect(rows(DECODE_ACTIVITY_BODIES)).toHaveLength(1);
  });

  it('times viewing the stream buffers as chart arrays', () => {
    const streams = streamsFromBuffers(streamBuffers({ time: [0, 5, 10] }));
    expect(Array.from(streams.time ?? [])).toEqual([0, 5, 10]);
    expect(rows(DECODE_STREAMS)).toHaveLength(1);
  });

  it('times decoding the preview tracks', () => {
    const tracks = buildPreviewTracks([
      { activityId: 'i1', encodedCoords: new ArrayBuffer(16) },
    ] as Parameters<typeof buildPreviewTracks>[0]);
    expect(tracks.get('i1')?.coordinates).toEqual([{ latitude: 46.2, longitude: 7.36 }]);
    expect(rows(DECODE_PREVIEW_TRACKS)).toHaveLength(1);
  });

  it('records no decoding row while Debug Mode is off', () => {
    setAppMetricsEnabled(false);
    parseBodies({ bodies: ['{"id":"i1"}'], intervalsIds: [], keys: ['i1'] });
    streamsFromBuffers(streamBuffers({ time: [0] }));
    expect(getFFIMetrics()).toEqual([]);
  });
});
