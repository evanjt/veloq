import { paceChartSeries, powerChartSeries } from '@/features/stats/lib/curveChartSeries';

const perKm = (speed: number) => 1000 / speed;
const per100 = (speed: number) => 100 / speed;
const speedOf = (secsPerKm: number) => 1000 / secsPerKm;

describe('paceChartSeries', () => {
  it('keeps the half marathon end of a flat run curve and spans it on both axes', () => {
    const distances = [400, 1000, 5000, 10000, 21000, 21097.5];
    const series = paceChartSeries(
      {
        distances,
        times: distances.map((d, i) => (i === 5 ? (d / 1000) * 630 : (d / 1000) * 600)),
        pace: [600, 600, 600, 600, 600, 630].map(speedOf),
      },
      perKm
    )!;
    expect(series.points.map((p) => p.distance)).toEqual(distances);
    const last = series.points[5];
    expect(last.pace).toBeCloseTo(630);
    expect(series.xDomain[1]).toBeCloseTo(Math.log10(21097.5));
    expect(series.yDomain[0]).toBeGreaterThanOrEqual(630);
  });

  it('keeps the 1500 m swim best and closely spaced points', () => {
    const series = paceChartSeries(
      {
        distances: [100, 400, 1450, 1500],
        times: [200, 840, 3480, 3750],
        pace: [200, 210, 240, 250].map((p) => 100 / p),
      },
      per100
    )!;
    expect(series.points.map((p) => p.distance)).toEqual([100, 400, 1450, 1500]);
    expect(series.points[3].time).toBe(3750);
    expect(series.xDomain[1]).toBeCloseTo(Math.log10(1500));
    expect(series.yDomain[0]).toBeGreaterThanOrEqual(250);
  });

  it('keeps samples closer together than any thinning gap, in distance order', () => {
    const distances = [60, 20, 40, 5000, 5050];
    const series = paceChartSeries(
      { distances, times: distances.map((d) => d / 3), pace: distances.map(() => 3) },
      perKm
    )!;
    expect(series.points.map((p) => p.distance)).toEqual([20, 40, 60, 5000, 5050]);
  });

  it('is null with no usable sample', () => {
    expect(paceChartSeries({ distances: [], times: [], pace: [] }, perKm)).toBeNull();
    expect(paceChartSeries(null, perKm)).toBeNull();
  });
});

describe('powerChartSeries', () => {
  it('keeps all 100 stored durations', () => {
    const secs = Array.from({ length: 100 }, (_, i) => i + 1);
    const watts = secs.map((s) => 1000 - s);
    const series = powerChartSeries(secs, watts)!;
    expect(series.points).toHaveLength(100);
    expect(series.points[99]).toEqual({ secs: 100, watts: 900 });
  });

  it('drops only non-positive values and sorts by duration', () => {
    const series = powerChartSeries([300, 5, 60, 0], [250, 900, 0, 100])!;
    expect(series.points).toEqual([
      { secs: 5, watts: 900 },
      { secs: 300, watts: 250 },
    ]);
    expect(series.yDomain[0]).toBeLessThanOrEqual(250);
    expect(series.yDomain[1]).toBeGreaterThanOrEqual(900);
  });

  it('is null when nothing is plottable', () => {
    expect(powerChartSeries([], [])).toBeNull();
    expect(powerChartSeries(null, [1])).toBeNull();
  });
});
