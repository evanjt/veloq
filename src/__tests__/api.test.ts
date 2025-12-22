import { parseStreams } from '../lib/streams';
import type { RawStreamItem } from '../types';

describe('parseStreams', () => {
  it('should combine lat/lng arrays into [lat, lng] tuples', () => {
    const rawStreams: RawStreamItem[] = [
      {
        type: 'latlng',
        name: null,
        data: [-33.8688, -33.8700, -33.8720], // latitudes
        data2: [151.2093, 151.2100, 151.2110], // longitudes
      },
    ];

    const result = parseStreams(rawStreams);

    expect(result.latlng).toEqual([
      [-33.8688, 151.2093],
      [-33.8700, 151.2100],
      [-33.8720, 151.2110],
    ]);
  });

  it('should not create latlng if data2 is missing', () => {
    const rawStreams: RawStreamItem[] = [
      {
        type: 'latlng',
        name: null,
        data: [-33.8688, -33.8700],
        // data2 is missing
      },
    ];

    const result = parseStreams(rawStreams);

    expect(result.latlng).toBeUndefined();
  });

  it('should prefer fixed_altitude over altitude', () => {
    const rawStreams: RawStreamItem[] = [
      {
        type: 'altitude',
        name: null,
        data: [100, 110, 120], // Raw GPS altitude (noisy)
      },
      {
        type: 'fixed_altitude',
        name: null,
        data: [105, 115, 125], // Corrected elevation
      },
    ];

    const result = parseStreams(rawStreams);

    // Should use fixed_altitude values
    expect(result.altitude).toEqual([105, 115, 125]);
  });

  it('should use altitude if fixed_altitude not available', () => {
    const rawStreams: RawStreamItem[] = [
      {
        type: 'altitude',
        name: null,
        data: [100, 110, 120],
      },
    ];

    const result = parseStreams(rawStreams);

    expect(result.altitude).toEqual([100, 110, 120]);
  });

  it('should parse all stream types', () => {
    const rawStreams: RawStreamItem[] = [
      { type: 'time', name: null, data: [0, 1, 2, 3] },
      { type: 'heartrate', name: null, data: [120, 130, 140, 150] },
      { type: 'watts', name: null, data: [200, 250, 300, 280] },
      { type: 'cadence', name: null, data: [85, 90, 92, 88] },
      { type: 'velocity_smooth', name: null, data: [8.0, 8.5, 9.0, 8.8] },
      { type: 'distance', name: null, data: [0, 100, 200, 300] },
    ];

    const result = parseStreams(rawStreams);

    expect(result.time).toEqual([0, 1, 2, 3]);
    expect(result.heartrate).toEqual([120, 130, 140, 150]);
    expect(result.watts).toEqual([200, 250, 300, 280]);
    expect(result.cadence).toEqual([85, 90, 92, 88]);
    expect(result.velocity_smooth).toEqual([8.0, 8.5, 9.0, 8.8]);
    expect(result.distance).toEqual([0, 100, 200, 300]);
  });

  it('should ignore unknown stream types', () => {
    const rawStreams: RawStreamItem[] = [
      { type: 'time', name: null, data: [0, 1, 2] },
      { type: 'some_unknown_type', name: null, data: [999, 999, 999] },
      { type: 'heartrate', name: null, data: [120, 130, 140] },
    ];

    const result = parseStreams(rawStreams);

    expect(result.time).toEqual([0, 1, 2]);
    expect(result.heartrate).toEqual([120, 130, 140]);
    expect(Object.keys(result)).toEqual(['time', 'heartrate']);
  });

  it('should return empty object for empty input', () => {
    const result = parseStreams([]);
    expect(result).toEqual({});
  });

  it('should handle real-world stream data structure', () => {
    // Simulates actual API response structure
    const rawStreams: RawStreamItem[] = [
      {
        type: 'latlng',
        name: null,
        data: [46.9481, 46.9485, 46.9490],
        data2: [7.4474, 7.4480, 7.4485],
      },
      {
        type: 'time',
        name: null,
        data: [0, 5, 10],
      },
      {
        type: 'fixed_altitude',
        name: 'Elevation (corrected)',
        data: [540, 542, 545],
      },
      {
        type: 'heartrate',
        name: 'Heart Rate',
        data: [95, 110, 125],
      },
    ];

    const result = parseStreams(rawStreams);

    expect(result.latlng?.length).toBe(3);
    expect(result.time?.length).toBe(3);
    expect(result.altitude?.length).toBe(3);
    expect(result.heartrate?.length).toBe(3);

    // Verify latlng structure
    expect(result.latlng?.[0]).toEqual([46.9481, 7.4474]);
  });
});
