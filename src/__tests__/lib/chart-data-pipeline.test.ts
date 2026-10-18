import { CHART_CONFIGS, getAvailableCharts } from '@/features/activity/lib/chartConfig';
import type { ActivityStreams, ActivityType } from '@/types';
import { streamsFromArrays as streamsOf } from '@/features/activity/lib/streams';

describe('stream unit conversion', () => {
  it('getStream converts raw stream units for each chart', () => {
    // speed: m/s → km/h
    expect(CHART_CONFIGS.speed.getStream!(streamsOf({ velocity_smooth: [1, 10] }))).toEqual(
      new Float64Array([3.6, 36])
    );
    // distance: meters → km
    expect(CHART_CONFIGS.distance.getStream!(streamsOf({ distance: [0, 1000, 5000] }))).toEqual(
      new Float64Array([0, 1, 5])
    );
    // wbal: joules → kJ
    expect(CHART_CONFIGS.wbal.getStream!(streamsOf({ wbal: [20000, 15500, 0, -1000] }))).toEqual(
      new Float64Array([20, 15.5, 0, -1])
    );
  });

  it('pace getStream converts m/s to min/km, guarding zero', () => {
    const data = CHART_CONFIGS.pace.getStream!(streamsOf({ velocity_smooth: [5, 0] }));
    expect(data![0]).toBeCloseTo(1000 / 5 / 60, 5);
    expect(data![1]).toBe(0);
  });

  it('speed convertToImperial converts km/h to mph', () => {
    expect(CHART_CONFIGS.speed.convertToImperial!(100)).toBeCloseTo(62.1371, 1);
  });

  it('pace formatValue formats minutes:seconds', () => {
    expect(CHART_CONFIGS.pace.formatValue!(4.5, true)).toBe('4:30');
    expect(CHART_CONFIGS.pace.formatValue!(3.0833, true)).toBe('3:05');
  });
});

describe('available charts filtering', () => {
  it('includes charts whose stream is present and excludes the rest', () => {
    const streams = streamsOf({
      watts: [100, 200, 300],
      heartrate: [120, 130, 140],
      velocity_smooth: [3, 4, 5],
    });
    const ids = getAvailableCharts(streams, 'Ride').map((c) => c.id);
    for (const id of ['power', 'heartrate', 'speed']) {
      expect(ids).toContain(id);
    }
    for (const id of ['elevation', 'temp', 'wbal', 'gap']) {
      expect(ids).not.toContain(id);
    }
  });

  it('returns empty for empty streams', () => {
    expect(getAvailableCharts({}, 'Ride')).toHaveLength(0);
  });

  it('excludes power and elevation when only heartrate is present', () => {
    const ids = getAvailableCharts(streamsOf({ heartrate: [120, 130] }), 'Ride').map((c) => c.id);
    expect(ids).toContain('heartrate');
    expect(ids).not.toContain('power');
    expect(ids).not.toContain('elevation');
  });

  it('excludes non-primary charts (distance, moving_time, elapsed_time)', () => {
    const streams = streamsOf({
      distance: [0, 100, 200],
      altitude: [100, 200, 300],
    });
    const ids = getAvailableCharts(streams, 'Ride').map((c) => c.id);
    // altitude maps to elevation (primary), distance is not primary
    expect(ids).toContain('elevation');
    for (const id of ['distance', 'moving_time', 'elapsed_time']) {
      expect(ids).not.toContain(id);
    }
  });

  it('gates optional charts on the presence of their backing stream', () => {
    // GAP is sourced from intervals.icu's `ga_velocity` stream, converted to
    // min/km at parse time. The chip shows iff `streams.gap` is populated.
    const presence: [keyof ActivityStreams, ActivityStreams, ActivityStreams][] = [
      [
        'temp',
        streamsOf({ heartrate: [120, 130], temp: [18, 19] }),
        streamsOf({ heartrate: [120, 130] }),
      ],
      [
        'wbal',
        streamsOf({ watts: [100, 200], wbal: [20000, 19900] }),
        streamsOf({ watts: [100, 200] }),
      ],
      [
        'gap',
        streamsOf({ velocity_smooth: [3, 4], gap: [4.5, 4.3] }),
        streamsOf({ velocity_smooth: [3, 4] }),
      ],
    ];
    for (const [id, withStream, withoutStream] of presence) {
      expect(getAvailableCharts(withStream, 'Run').map((c) => c.id)).toContain(id);
      expect(getAvailableCharts(withoutStream, 'Run').map((c) => c.id)).not.toContain(id);
    }
  });
});

describe('speed or pace by sport', () => {
  const moving = streamsOf({ heartrate: [120, 130, 140], velocity_smooth: [3, 4, 5] });
  const offered = (type: ActivityType) => getAvailableCharts(moving, type).map((c) => c.id);

  it('offers pace and not speed for a run', () => {
    expect(offered('Run')).toContain('pace');
    expect(offered('Run')).not.toContain('speed');
  });

  it('offers pace and not speed for a walk and a hike', () => {
    for (const type of ['Walk', 'Hike'] as const) {
      expect(offered(type)).toContain('pace');
      expect(offered(type)).not.toContain('speed');
    }
  });

  it('offers pace per 100 and not speed for a swim', () => {
    expect(offered('Swim')).toContain('pace');
    expect(offered('Swim')).not.toContain('speed');
    const swimPace = getAvailableCharts(moving, 'Swim').find((c) => c.id === 'pace');
    expect(swimPace?.unit).toBe('/100m');
  });

  it('offers speed and not pace for a ride', () => {
    expect(offered('Ride')).toContain('speed');
    expect(offered('Ride')).not.toContain('pace');
  });

  it('never offers both, whatever the sport', () => {
    for (const type of ['Run', 'Ride', 'Swim', 'Walk', 'Rowing', 'AlpineSki', 'Workout'] as const) {
      const ids = offered(type);
      expect(ids.includes('speed') && ids.includes('pace')).toBe(false);
    }
  });
});
