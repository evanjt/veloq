/**
 * Scenario: an activity's streams are drawn one lane each, on a shared
 * distance axis.
 *
 * Expected behaviour: every lane is drawn in its own unit at its own extent,
 * so no two streams share a scale; a quantity that starts at zero is drawn
 * from zero, grade spans zero either side, and a lane stack given a height
 * shares it out between its lanes.
 */

import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import {
  buildChartData,
  LANE_AXIS_HEIGHT,
  LANE_PLOT_HEIGHT,
  LANE_TITLE_HEIGHT,
  laneStack,
} from '@/features/stats/lib/combinedPlotData';
import type { ActivityStreams } from '@/types';

const SAMPLES = 600;

function kilnRide(): ActivityStreams {
  const time = Float64Array.from({ length: SAMPLES }, (_, i) => i);
  return {
    time,
    distance: time.map((t) => t * 8),
    watts: time.map((t) => 180 + (t % 40)),
    heartrate: time.map((t) => 120 + (t % 30)),
    altitude: time.map((t) => 400 + Math.sin(t / 50) * 30),
    grade_smooth: time.map((t) => Math.sin(t / 40) * 6),
    velocity_smooth: time.map((t) => (t % 100 < 10 ? 0 : 3 + (t % 5) * 0.1)),
  };
}

function lanes(selected: Parameters<typeof buildChartData>[1]) {
  return buildChartData(kilnRide(), selected, CHART_CONFIGS, true, 'distance', 300);
}

describe('the activity stream lanes', () => {
  it('give power, heart rate and elevation each their own extent, never a shared one', () => {
    const { seriesInfo } = lanes(['power', 'heartrate', 'elevation']);
    const domainOf = (id: string) => seriesInfo.find((s) => s.id === id)?.domain;

    expect(seriesInfo.map((s) => s.id)).toEqual(['power', 'heartrate', 'elevation']);
    expect(domainOf('power')).toEqual([0, 219]);
    expect(domainOf('heartrate')).toEqual([120, 149]);
    const [low, high] = domainOf('elevation')!;
    expect(low).toBeCloseTo(370, 0);
    expect(high).toBeCloseTo(430, 0);
    expect(domainOf('power')).not.toEqual(domainOf('heartrate'));
  });

  it('carry each stream in its own unit rather than squeezed to a shared 0 to 1', () => {
    const { chartData, indexMap } = lanes(['power', 'heartrate']);
    const watts = kilnRide().watts!;

    expect(chartData.length).toBeGreaterThan(0);
    chartData.forEach((point, i) => {
      expect(point.power).toBe(watts[indexMap[i]]);
    });
    expect(Math.max(...chartData.map((p) => p.heartrate))).toBe(149);
  });

  it('draw grade either side of zero', () => {
    const [low, high] = lanes(['grade']).seriesInfo[0].domain;
    expect(low).toBeLessThan(0);
    expect(high).toBeGreaterThan(0);
    expect(lanes(['grade']).seriesInfo[0].kind).toBe('signed');
  });

  it('draw elevation and temperature as context and every other stream as a line', () => {
    const { seriesInfo } = lanes(['elevation', 'power', 'heartrate']);
    expect(seriesInfo.map((s) => s.kind)).toEqual(['context', 'line', 'line']);
  });

  it('leave a pace lane its moving extent, the stops out of it', () => {
    const { seriesInfo, chartData } = lanes(['pace']);
    const [fastest, slowest] = seriesInfo[0].domain;

    // 3.4 m/s is 4:54 /km and 3.0 m/s is 5:33 /km; a stop would be hours.
    expect(fastest).toBeCloseTo(1000 / 3.4 / 60, 2);
    expect(slowest).toBeCloseTo(1000 / 3 / 60, 2);
    expect(chartData.some((p) => Number.isNaN(p.pace))).toBe(true);
  });

  it('give a flat stream a span, so its line is drawn rather than collapsed', () => {
    const time = Float64Array.from({ length: 10 }, (_, i) => i);
    const streams = { time, distance: time.map((t) => t * 10), heartrate: time.map(() => 140) };
    const [low, high] = buildChartData(streams, ['heartrate'], CHART_CONFIGS, true, 'distance', 300)
      .seriesInfo[0].domain;

    expect(low).toBeLessThan(140);
    expect(high).toBeGreaterThan(140);
  });
});

describe('the lane stack', () => {
  it('draws each lane at the lane height under its title when the page scrolls', () => {
    expect(laneStack(3)).toEqual({
      plotHeight: LANE_PLOT_HEIGHT,
      height: 3 * (LANE_TITLE_HEIGHT + LANE_PLOT_HEIGHT) + LANE_AXIS_HEIGHT,
    });
  });

  it('shares a given height between three lanes and fits inside it', () => {
    const { plotHeight, height } = laneStack(3, 360);

    expect(plotHeight).toBe(Math.floor((360 - LANE_AXIS_HEIGHT - 3 * LANE_TITLE_HEIGHT) / 3));
    expect(height).toBeLessThanOrEqual(360);
  });

  it('gives one lane the whole height it is given', () => {
    expect(laneStack(1, 200).plotHeight).toBe(200 - LANE_AXIS_HEIGHT - LANE_TITLE_HEIGHT);
  });

  it('takes a title grown by the text size out of the shared height', () => {
    expect(laneStack(2, 300, 24).plotHeight).toBe(Math.floor((300 - LANE_AXIS_HEIGHT - 48) / 2));
  });
});
