/**
 * Scenario: the insight sheets drew their history as a bare line with each
 * sample spread evenly by index, so a three-week gap between two efforts took
 * the same width as a day, and the axis dates sat on the wrong samples.
 *
 * Expected behaviour: a dated series is placed on its dates, the first and
 * last dates label the ends, the value axis is padded and never degenerate,
 * and a time series where lower is better can be drawn with the best at the
 * top.
 */

import { seriesChartModel } from '@/features/insights/lib/seriesChart';

const DAY = 86_400;
const formatDate = (epochSeconds: number) => `d${Math.round(epochSeconds / DAY)}`;

describe('seriesChartModel', () => {
  it('places each sample on its date, not its index', () => {
    const model = seriesChartModel(
      [
        { value: 300, date: 1 * DAY },
        { value: 290, date: 2 * DAY },
        { value: 310, date: 30 * DAY },
      ],
      { formatDate }
    );

    expect(model?.data.map((d) => d.x)).toEqual([1 * DAY, 2 * DAY, 30 * DAY]);
    expect(model?.data.map((d) => d.value)).toEqual([300, 290, 310]);
  });

  it('labels the first and last dates at the values they name', () => {
    const model = seriesChartModel(
      [
        { value: 50, date: 10 * DAY },
        { value: 52, date: 11 * DAY },
        { value: 55, date: 17 * DAY },
      ],
      { formatDate }
    );

    expect(model?.xLabels).toEqual([
      { label: 'd10', value: 10 * DAY },
      { label: 'd17', value: 17 * DAY },
    ]);
    const [lo, hi] = model!.xDomain;
    expect(lo).toBeLessThan(10 * DAY);
    expect(hi).toBeGreaterThan(17 * DAY);
  });

  it('adds a middle date label once the series is long enough to need one', () => {
    const samples = [1, 2, 3, 4, 9].map((day, i) => ({ value: 40 + i, date: day * DAY }));
    const model = seriesChartModel(samples, { formatDate });

    expect(model?.xLabels.map((l) => l.label)).toEqual(['d1', 'd4', 'd9']);
    expect(model?.xLabels[1].value).toBe(4 * DAY);
  });

  it('labels no middle date when the sample nearest the middle crowds an end', () => {
    const samples = [1, 2, 3, 4, 20].map((day, i) => ({ value: 40 + i, date: day * DAY }));
    const model = seriesChartModel(samples, { formatDate });

    expect(model?.xLabels.map((l) => l.label)).toEqual(['d1', 'd20']);
  });

  it('pads the value axis around the data', () => {
    const model = seriesChartModel(
      [
        { value: 40, date: DAY },
        { value: 60, date: 2 * DAY },
      ],
      { formatDate }
    );

    const [lo, hi] = model!.yDomain;
    expect(lo).toBeLessThan(40);
    expect(hi).toBeGreaterThan(60);
  });

  it('gives a flat series a value axis with height', () => {
    const model = seriesChartModel(
      [
        { value: 55, date: DAY },
        { value: 55, date: 2 * DAY },
      ],
      { formatDate }
    );

    const [lo, hi] = model!.yDomain;
    expect(lo).toBeLessThan(55);
    expect(hi).toBeGreaterThan(55);
  });

  it('puts the lowest value at the top when lower is better', () => {
    const model = seriesChartModel(
      [
        { value: 300, date: DAY },
        { value: 280, date: 2 * DAY },
      ],
      { formatDate, invert: true }
    );

    const [bottom, top] = model!.yDomain;
    expect(top).toBeLessThan(280);
    expect(bottom).toBeGreaterThan(300);
  });

  it('drops a sample that is not a number', () => {
    const model = seriesChartModel(
      [
        { value: 50, date: DAY },
        { value: Number.NaN, date: 2 * DAY },
        { value: 54, date: 3 * DAY },
      ],
      { formatDate }
    );

    expect(model?.data.map((d) => d.value)).toEqual([50, 54]);
  });

  it('draws nothing from fewer than two usable samples', () => {
    expect(seriesChartModel([], { formatDate })).toBeNull();
    expect(seriesChartModel([{ value: 50, date: DAY }], { formatDate })).toBeNull();
    expect(
      seriesChartModel(
        [
          { value: 50, date: DAY },
          { value: Number.POSITIVE_INFINITY, date: 2 * DAY },
        ],
        { formatDate }
      )
    ).toBeNull();
  });

  it('spreads an undated series by order and labels no dates', () => {
    const model = seriesChartModel([{ value: 3 }, { value: 4 }, { value: 6 }], { formatDate });

    expect(model?.data.map((d) => d.x)).toEqual([0, 1, 2]);
    expect(model?.data.every((d) => d.date === null)).toBe(true);
    expect(model?.xLabels).toEqual([]);
  });

  it('spreads a series whose dates are all one instant by order', () => {
    const model = seriesChartModel(
      [
        { value: 3, date: DAY },
        { value: 4, date: DAY },
        { value: 6, date: DAY },
      ],
      { formatDate }
    );

    expect(model?.data.map((d) => d.x)).toEqual([0, 1, 2]);
  });

  it('spans a shared range so two charts stacked over one time axis line up', () => {
    const range = { from: 1 * DAY, to: 100 * DAY };
    const fitness = seriesChartModel(
      [
        { value: 230, date: 1 * DAY },
        { value: 262, date: 90 * DAY },
      ],
      { formatDate, xRange: range }
    );
    const efforts = seriesChartModel(
      [
        { value: 300, date: 10 * DAY },
        { value: 320, date: 40 * DAY },
      ],
      { formatDate, invert: true, xRange: range }
    );

    expect(efforts?.xDomain).toEqual(fitness?.xDomain);
    expect(efforts?.xLabels.map((l) => l.label)).toEqual(['d1', 'd100']);
  });
});
