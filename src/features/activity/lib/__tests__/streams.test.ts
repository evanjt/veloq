import { parseStreams } from '@/features/activity/lib/streams';
import type { RawStreamItem } from '@/types';

/**
 * Scenario: an activity with a dropped GPS fix.
 * Expected behaviour: every series comes back in the index space the stored
 * track occupies, the same rule `parse_streams` applies in Rust.
 */
describe('parseStreams latlng index space', () => {
  const raw: RawStreamItem[] = [
    { type: 'latlng', name: null, data: [46.0, NaN, 46.2], data2: [7.0, 7.1, 7.2] },
    { type: 'time', name: null, data: [0, 5, 10] },
    { type: 'heartrate', name: null, data: [120, 130, 140] },
    { type: 'altitude', name: null, data: [100, 110, 120] },
  ];

  it('drops the masked sample from every series', () => {
    const streams = parseStreams(raw);

    expect(streams.latlng).toEqual([
      [46.0, 7.0],
      [46.2, 7.2],
    ]);
    expect(streams.time).toEqual([0, 10]);
    expect(streams.heartrate).toEqual([120, 140]);
    expect(streams.altitude).toEqual([100, 120]);
  });

  it('drops an out-of-range coordinate', () => {
    const streams = parseStreams([
      { type: 'latlng', name: null, data: [46.0, 200], data2: [7.0, 7.1] },
      { type: 'watts', name: null, data: [200, 210] },
    ]);

    expect(streams.latlng).toEqual([[46.0, 7.0]]);
    expect(streams.watts).toEqual([200]);
  });

  it('keeps every sample when the response carries no latlng', () => {
    const streams = parseStreams([{ type: 'heartrate', name: null, data: [120, 130, 140] }]);

    expect(streams.heartrate).toEqual([120, 130, 140]);
  });

  it('reads NaN past the end of a short series rather than shifting it', () => {
    const streams = parseStreams([
      { type: 'latlng', name: null, data: [46.0, 46.1], data2: [7.0, 7.1] },
      { type: 'cadence', name: null, data: [85] },
    ]);

    expect(streams.cadence).toEqual([85, NaN]);
  });

  it('prefers fixed_altitude whichever order it arrives in', () => {
    const streams = parseStreams([
      { type: 'fixed_altitude', name: null, data: [101, 111] },
      { type: 'altitude', name: null, data: [100, 110] },
    ]);

    expect(streams.altitude).toEqual([101, 111]);
  });
});
