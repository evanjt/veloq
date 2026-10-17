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
  daysTable,
  heatmapSummary,
  lanesSummary,
  partsSummary,
  seriesSummary,
  seriesTable,
  stripSummary,
  type SummaryDay,
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

const kilnDays = (counts: number[], hours: (number | null)[] = []): SummaryDay[] =>
  counts.map((count, i) => ({
    label: `${i + 1} May`,
    count,
    value: hours[i],
    cells: [String(count)],
  }));
const hoursOf = (v: number) => `${v} h`;

describe('stripSummary', () => {
  it('says there is no data for an empty strip', () => {
    expect(stripSummary('Firings', [], t)).toBe('Firings: no data.');
  });

  it('reads a single day as active or not', () => {
    expect(stripSummary('Firings', kilnDays([2]), t)).toBe('Firings, 1 May: active.');
    expect(stripSummary('Firings', kilnDays([0]), t)).toBe('Firings, 1 May: no activity.');
  });

  it('counts the active days and names the longest break between two of them', () => {
    expect(stripSummary('Firings', kilnDays([1, 0, 0, 0, 2, 0, 1, 0, 0]), t)).toBe(
      'Firings, 1 May to 9 May: active on 3 of 9 days. Longest break 3 days.'
    );
  });

  it('does not count the quiet days after the last active one as a break', () => {
    expect(stripSummary('Firings', kilnDays([1, 0, 1, 0, 0, 0, 0]), t)).toBe(
      'Firings, 1 May to 7 May: active on 2 of 7 days. Longest break 1 day.'
    );
  });

  it('names no break when every day is active', () => {
    expect(stripSummary('Firings', kilnDays([1, 1, 3]), t)).toBe(
      'Firings, 1 May to 3 May: active on 3 of 3 days.'
    );
  });

  it('says so when no day in the span is active', () => {
    expect(stripSummary('Firings', kilnDays([0, 0, 0]), t)).toBe(
      'Firings, 1 May to 3 May: no activity.'
    );
  });
});

describe('heatmapSummary', () => {
  it('says there is no data for an empty calendar', () => {
    expect(heatmapSummary('Kiln calendar', [], hoursOf, t)).toBe('Kiln calendar: no data.');
  });

  it('reads a single day with its figure', () => {
    expect(heatmapSummary('Kiln calendar', kilnDays([1], [3]), hoursOf, t)).toBe(
      'Kiln calendar, 1 May: active. Peak 3 h on 1 May.'
    );
  });

  it('names the peak day across a gap, skipping a day with no figure', () => {
    expect(
      heatmapSummary('Kiln calendar', kilnDays([1, 0, 2, 1], [2, null, null, 5]), hoursOf, t)
    ).toBe('Kiln calendar, 1 May to 4 May: active on 3 of 4 days. Peak 5 h on 4 May.');
  });

  it('names no peak when no active day has a figure', () => {
    expect(heatmapSummary('Kiln calendar', kilnDays([1, 0], [null, 9]), hoursOf, t)).toBe(
      'Kiln calendar, 1 May to 2 May: active on 1 of 2 days.'
    );
  });
});

describe('daysTable', () => {
  it('has one row per active day, its cells after the date', () => {
    const table = daysTable('Firings', ['Date', 'Activities'], kilnDays([1, 0, 2]));
    expect(table.columns).toEqual(['Date', 'Activities']);
    expect(table.rows).toEqual([
      { key: '1 May', cells: ['1 May', '1'] },
      { key: '3 May', cells: ['3 May', '2'] },
    ]);
  });

  it('has no rows when no day is active', () => {
    expect(daysTable('Firings', ['Date'], kilnDays([0, 0])).rows).toEqual([]);
  });
});
