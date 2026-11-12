/**
 * Scenario: several rows of a table are selected to compare side by side.
 *
 * Expected behaviour: shift-click extends a contiguous range, ctrl-click
 * toggles one row, a fifth selection drops the oldest and reports it, the
 * selection round-trips through the hash, and the compare rows mark the best
 * value, leaving a cell blank where a column has no value rather than
 * marking a missing value as best.
 */

import {
  MAX_COMPARED,
  compareRows,
  compareColour,
  readIds,
  select,
  writeIds,
} from '../../../web/connect/compare';
import { feedQuery, readFeedQuery } from '../../../web/connect/table';
import { parse, write } from '../../../web/connect/router';

const order = ['a', 'b', 'c', 'd', 'e', 'f'];
const none = { ids: [] as string[], anchor: null as string | null };

describe('select', () => {
  it('extends a contiguous range from the anchor in either direction', () => {
    expect(select({ ids: [], anchor: 'b' }, order, 'd', 'range').ids).toEqual(['b', 'c', 'd']);
    expect(select({ ids: [], anchor: 'd' }, order, 'b', 'range').ids).toEqual(['d', 'c', 'b']);
  });

  it('keeps the four nearest the target when a range is longer than four', () => {
    const next = select({ ids: [], anchor: 'a' }, order, 'f', 'range');
    expect(next.ids).toEqual(['c', 'd', 'e', 'f']);
    expect(next.dropped).toEqual(['a', 'b']);
  });

  it('treats a range with no anchor as the clicked row alone', () => {
    expect(select(none, order, 'c', 'range').ids).toEqual(['c']);
  });

  it('toggles one row on and off, starting from the anchor', () => {
    const on = select({ ids: [], anchor: 'a' }, order, 'c', 'toggle');
    expect(on.ids).toEqual(['a', 'c']);
    expect(select(on, order, 'c', 'toggle').ids).toEqual(['a']);
  });

  it('drops the oldest when a fifth is added and says which', () => {
    const four = { ids: ['a', 'b', 'c', 'd'], anchor: 'a' };
    const next = select(four, order, 'e', 'toggle');
    expect(next.ids).toEqual(['b', 'c', 'd', 'e']);
    expect(next.dropped).toEqual(['a']);
    expect(next.ids).toHaveLength(MAX_COMPARED);
  });

  it('a plain click selects that row alone', () => {
    expect(select({ ids: ['a', 'b'], anchor: 'a' }, order, 'e', 'single').ids).toEqual(['e']);
  });
});

describe('the hash', () => {
  it('round-trips ids, including ones with a comma or a slash', () => {
    const ids = ['i1', 'x,y', 'a/b', 'demo 3'];
    expect(readIds(writeIds(ids))).toEqual(ids);
    const hash = write({
      screen: 'feed',
      id: null,
      query: feedQuery({ range: null, families: [], sort: null, id: 'i1', ids }),
    });
    expect(readFeedQuery(parse(hash)).ids).toEqual(ids);
    expect(readFeedQuery(parse(hash)).id).toBe('i1');
  });

  it('writes no ids for fewer than two, and reads at most four', () => {
    expect(writeIds(['a'])).toBeNull();
    expect(readIds('a,b,c,d,e,f')).toEqual(['a', 'b', 'c', 'd']);
    expect(readIds(null)).toEqual([]);
    expect(readIds('a,,a,b')).toEqual(['a', 'b']);
  });
});

describe('compareRows', () => {
  const cards = [
    { id: 'a', name: 'A', distance: 40000, movingTime: 3600, avgHr: 150 },
    { id: 'b', name: 'B', distance: 50000, movingTime: 3000, avgHr: null },
    { id: 'c', name: 'C', distance: 50000, movingTime: null, avgHr: null },
  ];

  it('marks the best value, every tie, and blanks a missing value', () => {
    const rows = compareRows(cards, {});
    const distance = rows.find((r) => r.label === 'Distance');
    expect(distance?.cells.map((c) => c.best)).toEqual([false, true, true]);
    const time = rows.find((r) => r.label === 'Moving time');
    expect(time?.cells.map((c) => c.text)).toEqual(['1 h 00 min', '50 min', null]);
    expect(time?.cells.map((c) => c.best)).toEqual([false, true, false]);
  });

  it('marks nothing when only one column has a value', () => {
    const hr = compareRows(cards, {}).find((r) => r.label === 'Average heart rate');
    expect(hr?.cells.map((c) => c.best)).toEqual([false, false, false]);
    expect(hr?.cells[0]?.text).toBe('150 bpm');
  });

  it('adds elapsed time and the delta to the best for a pass', () => {
    const rows = compareRows(cards, {}, { a: { elapsed: 120 }, b: { elapsed: 100 }, c: {} });
    const elapsed = rows.find((r) => r.label === 'Elapsed time');
    expect(elapsed?.cells.map((c) => c.best)).toEqual([false, true, false]);
    const delta = rows.find((r) => r.label === 'Delta to best');
    expect(delta?.cells.map((c) => c.text)).toEqual(['+0:20', '0:00', null]);
  });
});

describe('compareColour', () => {
  it('gives each selected column its own colour', () => {
    const colours = [0, 1, 2, 3].map(compareColour);
    expect(new Set(colours).size).toBe(4);
  });
});
