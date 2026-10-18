/**
 * Scenario: an imperial runner reads the pace curve. The values beside it are
 * in miles, and the distance axis under it read '400m', '1km' and '5km'
 * whatever the unit setting.
 *
 * Expected behaviour: the axis marks are built from the unit setting, so an
 * imperial athlete reads miles at the quarter, the mile, 5k, 10k and the half,
 * each mark sitting on the distance it names.
 */

import { paceCurveAxisLabels } from '@/features/stats/lib/curveChartSeries';

const METRES_PER_MILE = 1609.344;

describe('the pace curve distance axis', () => {
  it('reads miles for an imperial athlete', () => {
    const labels = paceCurveAxisLabels(false);

    expect(labels.map((l) => l.label)).toEqual(['0.25 mi', '1 mi', '3.1 mi', '6.2 mi', '13.1 mi']);
    expect(labels[0]!.value).toBeCloseTo(Math.log10(METRES_PER_MILE / 4), 6);
    expect(labels[1]!.value).toBeCloseTo(Math.log10(METRES_PER_MILE), 6);
    expect(labels[2]!.value).toBeCloseTo(Math.log10(5000), 6);
  });

  it('reads metres and kilometres for a metric athlete', () => {
    const labels = paceCurveAxisLabels(true);

    expect(labels.map((l) => l.label)).toEqual(['400 m', '1 km', '5 km', '10 km', '21.1 km']);
    expect(labels.map((l) => 10 ** l.value)).toEqual([
      expect.closeTo(400, 6),
      expect.closeTo(1000, 6),
      expect.closeTo(5000, 6),
      expect.closeTo(10000, 6),
      expect.closeTo(21097.5, 6),
    ]);
  });

  it('hands the chart the same array on every call, so label placement is not redone', () => {
    expect(paceCurveAxisLabels(false)).toBe(paceCurveAxisLabels(false));
    expect(paceCurveAxisLabels(true)).toBe(paceCurveAxisLabels(true));
  });
});
