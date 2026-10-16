/**
 * Scenario: a screen reader reads a chart as one sentence and the Show data sheet as a table,
 * both built from the rows the chart plots.
 *
 * Expected behaviour: the sentence names the span, the latest value, the range and the average
 * of the plotted values, skipping a missing day rather than counting it as zero, and says so
 * plainly when nothing is plotted.
 */

import {
  curveSummary,
  lanesSummary,
  partsSummary,
  seriesSummary,
  seriesTable,
} from '@/shared/charts';
import { i18n, initialiseI18n } from '@/i18n';
import { ABSENT } from '@/shared/format/absent';

const t = i18n.t.bind(i18n);
const watts = (v: number) => `${Math.round(v)} W`;

const tide = (values: (number | null)[]) => ({
  name: 'Tide height',
  unit: 'cm',
  format: (v: number) => `${Math.round(v)} cm`,
  points: values.map((value, i) => ({ label: `${i + 1} Mar`, value })),
});

beforeAll(async () => {
  await initialiseI18n();
});

describe('seriesSummary', () => {
  it('names the span, the latest value, the range and the average', () => {
    expect(seriesSummary(tide([10, 40, 30]), t)).toBe(
      'Tide height, 1 Mar to 3 Mar: latest 30 cm, range 10 cm to 40 cm, average 27 cm.'
    );
  });

  it('says there is no data for an empty series', () => {
    expect(seriesSummary(tide([]), t)).toBe('Tide height: no data.');
  });

  it('says there is no data when every point is missing', () => {
    expect(seriesSummary(tide([null, null]), t)).toBe('Tide height: no data.');
  });

  it('reads a single point as its day and value', () => {
    expect(seriesSummary(tide([25]), t)).toBe('Tide height, 1 Mar: 25 cm.');
  });

  it('skips a missing day rather than reading it as zero', () => {
    expect(seriesSummary(tide([10, null, 30]), t)).toBe(
      'Tide height, 1 Mar to 3 Mar: latest 30 cm, range 10 cm to 30 cm, average 20 cm.'
    );
  });

  it('spans only the plotted days when the ends are missing', () => {
    expect(seriesSummary(tide([null, 12, 18, null]), t)).toBe(
      'Tide height, 2 Mar to 3 Mar: latest 18 cm, range 12 cm to 18 cm, average 15 cm.'
    );
  });

  it('reads a non-finite value as missing', () => {
    expect(seriesSummary(tide([Number.NaN, 8]), t)).toBe('Tide height, 2 Mar: 8 cm.');
  });
});

describe('lanesSummary', () => {
  it('reads each lane in turn under the chart title', () => {
    const ebb = { ...tide([5, 7]), name: 'Ebb' };
    const flow = { ...tide([]), name: 'Flow' };
    expect(lanesSummary('Harbour', [ebb, flow], t)).toBe(
      'Harbour. Ebb, 1 Mar to 2 Mar: latest 7 cm, range 5 cm to 7 cm, average 6 cm. Flow: no data.'
    );
  });
});

describe('curveSummary', () => {
  const kiln = (values: number[]) => ({
    name: 'Kiln output',
    format: watts,
    points: values.map((value, i) => ({ label: `${(i + 1) * 10} s`, value })),
  });

  it('reads the curve from its first to its last point, with its peak', () => {
    expect(curveSummary(kiln([900, 600, 300]), t)).toBe(
      'Kiln output, 10 s to 30 s: 900 W at 10 s, 300 W at 30 s, peak 900 W.'
    );
  });

  it('takes the lowest value as the peak of a pace curve', () => {
    const pace = { ...kiln([300, 240, 330]), name: 'Rowing pace', lowerIsBetter: true };
    expect(curveSummary(pace, t)).toBe(
      'Rowing pace, 10 s to 30 s: 300 W at 10 s, 330 W at 30 s, peak 240 W.'
    );
  });

  it('says there is no data for an empty curve', () => {
    expect(curveSummary(kiln([]), t)).toBe('Kiln output: no data.');
  });
});

describe('partsSummary', () => {
  it('lists each part under the chart title', () => {
    expect(
      partsSummary(
        'Glaze time',
        [
          { label: 'Low', value: '10 min' },
          { label: 'High', value: '5 min' },
        ],
        t
      )
    ).toBe('Glaze time: Low 10 min, High 5 min.');
  });

  it('says there is no data when there are no parts', () => {
    expect(partsSummary('Glaze time', [], t)).toBe('Glaze time: no data.');
  });
});

describe('seriesTable', () => {
  it('has one row per plotted day, the unit in each header, and the absent mark for a gap', () => {
    const ebb = { ...tide([5, null, 9]), name: 'Ebb' };
    const flow = { ...tide([null, null, 2]), name: 'Flow', unit: undefined };
    const table = seriesTable('Harbour', 'Day', [ebb, flow]);
    expect(table.title).toBe('Harbour');
    expect(table.columns).toEqual(['Day', 'Ebb (cm)', 'Flow']);
    expect(table.rows).toEqual([
      { key: '1 Mar', cells: ['1 Mar', '5 cm', ABSENT] },
      { key: '3 Mar', cells: ['3 Mar', '9 cm', '2 cm'] },
    ]);
  });

  it('has no rows for an empty series', () => {
    expect(seriesTable('Harbour', 'Day', [tide([])]).rows).toEqual([]);
  });
});
