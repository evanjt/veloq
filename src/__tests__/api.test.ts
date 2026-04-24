import { parseStreams } from '../lib/utils/streams';
import type { RawStreamItem } from '../types';

describe('parseStreams', () => {
  it('should combine lat/lng arrays into [lat, lng] tuples', () => {
    const rawStreams: RawStreamItem[] = [
      {
        type: 'latlng',
        name: null,
        data: [-33.8688, -33.87, -33.872], // latitudes
        data2: [151.2093, 151.21, 151.211], // longitudes
      },
    ];

    const result = parseStreams(rawStreams);

    expect(result.latlng).toEqual([
      [-33.8688, 151.2093],
      [-33.87, 151.21],
      [-33.872, 151.211],
    ]);
  });

  it('should not create latlng if data2 is missing', () => {
    const rawStreams: RawStreamItem[] = [
      {
        type: 'latlng',
        name: null,
        data: [-33.8688, -33.87],
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

  // 'parse all stream types' test removed — covered by contracts.test.ts test 7

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

  it('latlng stream with shorter data2 does not produce undefined', () => {
    const result = parseStreams([
      { type: 'latlng', name: null, data: [40.7, 34.0], data2: [-74.0] },
    ]);
    const latlng = result.latlng;
    expect(latlng?.every((pt) => pt.every((v) => typeof v === 'number'))).toBe(true);
    expect(latlng).toHaveLength(1);
  });

  it('latlng stream with shorter data truncates to min length', () => {
    const result = parseStreams([
      { type: 'latlng', name: null, data: [10.0], data2: [20.0, 30.0, 40.0] },
    ]);
    expect(result.latlng).toHaveLength(1);
    expect(result.latlng).toEqual([[10.0, 20.0]]);
  });

  it('latlng stream with empty data2 produces no tuples', () => {
    const result = parseStreams([{ type: 'latlng', name: null, data: [10.0, 20.0], data2: [] }]);
    expect(result.latlng).toHaveLength(0);
  });

  it('maps w_bal to streams.wbal as joules', () => {
    const result = parseStreams([{ type: 'w_bal', name: null, data: [20000, 19500, 19000] }]);
    expect(result.wbal).toEqual([20000, 19500, 19000]);
  });

  it('converts ga_velocity m/s to streams.gap min/km', () => {
    const result = parseStreams([{ type: 'ga_velocity', name: null, data: [5, 4, 0] }]);
    expect(result.gap?.[0]).toBeCloseTo(1000 / 5 / 60, 5);
    expect(result.gap?.[1]).toBeCloseTo(1000 / 4 / 60, 5);
    expect(result.gap?.[2]).toBe(0);
  });

  it('should handle real-world stream data structure', () => {
    // Simulates actual API response structure
    const rawStreams: RawStreamItem[] = [
      {
        type: 'latlng',
        name: null,
        data: [46.9481, 46.9485, 46.949],
        data2: [7.4474, 7.448, 7.4485],
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
