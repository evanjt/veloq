/**
 * Scenario: the feed is a sortable table whose filters, sort and selection
 * live in the hash query and whose rows are stepped with the keyboard.
 *
 * Expected behaviour: a sort keeps rows with no value last in either
 * direction; the hash query round-trips range, sport, sort and selection;
 * a range preset names the same days the phone's does; the arrow keys move the
 * selection within the loaded rows and stop at the ends.
 */

import {
  COLUMNS,
  feedQuery,
  readFeedQuery,
  rangeBounds,
  selectionAfter,
  sortRows,
  type Row,
} from '../../../web/connect/table';
import { parse, write } from '../../../web/connect/router';

const row = (id: string, over: Partial<Row> = {}): Row => ({ id, name: id, ...over });

describe('sortRows', () => {
  const rows = [
    row('a', { distance: 30 }),
    row('b', { distance: null }),
    row('c', { distance: 10 }),
    row('d'),
    row('e', { distance: 20 }),
  ];

  it('keeps rows with no value last ascending and descending', () => {
    expect(sortRows(rows, { column: 'distance', dir: 'asc' }).map((r) => r.id)).toEqual([
      'c',
      'e',
      'a',
      'b',
      'd',
    ]);
    expect(sortRows(rows, { column: 'distance', dir: 'desc' }).map((r) => r.id)).toEqual([
      'a',
      'e',
      'c',
      'b',
      'd',
    ]);
  });

  it('orders text without regard to case and leaves the input alone', () => {
    const named = [row('1', { name: 'beta' }), row('2', { name: 'Alpha' })];
    expect(sortRows(named, { column: 'name', dir: 'asc' }).map((r) => r.id)).toEqual(['2', '1']);
    expect(named.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('keeps the loaded order when no sort is chosen', () => {
    expect(sortRows(rows, null)).toEqual(rows);
  });

  it('has every column the table shows', () => {
    expect(COLUMNS.map((c) => c.key)).toEqual([
      'date',
      'name',
      'sport',
      'distance',
      'time',
      'climb',
      'load',
      'hr',
      'power',
    ]);
  });
});

describe('the hash query', () => {
  it('round-trips range, sport, sort and selection', () => {
    const state = {
      range: 'thisYear' as const,
      families: ['ride' as const, 'run' as const],
      sort: { column: 'load' as const, dir: 'desc' as const },
      id: 'i 42',
      ids: [] as string[],
    };
    const hash = write({ screen: 'feed', id: null, query: feedQuery(state) });
    expect(readFeedQuery(parse(hash))).toEqual(state);
  });

  it('reads an empty query as no range, no sport, no sort and nothing selected', () => {
    expect(readFeedQuery(parse('#/feed'))).toEqual({
      range: null,
      families: [],
      sort: null,
      id: null,
      ids: [],
    });
  });

  it('ignores a range, a sport or a sort it does not know', () => {
    const got = readFeedQuery(parse('#/feed?range=never&sport=ride,quad&sort=nope:asc'));
    expect(got).toEqual({ range: null, families: ['ride'], sort: null, id: null, ids: [] });
    expect(readFeedQuery(parse('#/feed?sort=name:sideways')).sort).toBeNull();
  });

  it('writes nothing for the defaults', () => {
    expect(feedQuery({ range: null, families: [], sort: null, id: null, ids: [] })).toEqual([]);
  });
});

describe('rangeBounds', () => {
  const today = new Date(2026, 10, 12, 15, 30);
  const secs = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
    new Date(y, m, d, h, min, s).getTime() / 1000;

  it('reaches back 90 days including today, to the end of today', () => {
    expect(rangeBounds('last90Days', today)).toEqual({
      oldestTs: secs(2026, 10, 12 - 89),
      newestTs: secs(2026, 10, 12, 23, 59, 59),
    });
  });

  it('names this year from 1 January and last year as the whole of it', () => {
    expect(rangeBounds('thisYear', today)).toEqual({
      oldestTs: secs(2026, 0, 1),
      newestTs: secs(2026, 10, 12, 23, 59, 59),
    });
    expect(rangeBounds('lastYear', today)).toEqual({
      oldestTs: secs(2025, 0, 1),
      newestTs: secs(2025, 11, 31, 23, 59, 59),
    });
  });

  it('is unbounded with no preset', () => {
    expect(rangeBounds(null, today)).toEqual({ oldestTs: null, newestTs: null });
  });
});

describe('selectionAfter', () => {
  const ids = ['a', 'b', 'c'];

  it('steps down and up within the rows', () => {
    expect(selectionAfter(ids, 'a', 'next')).toBe('b');
    expect(selectionAfter(ids, 'c', 'previous')).toBe('b');
  });

  it('stops at the ends', () => {
    expect(selectionAfter(ids, 'c', 'next')).toBe('c');
    expect(selectionAfter(ids, 'a', 'previous')).toBe('a');
  });

  it('starts at the first row when nothing, or a row no longer loaded, is selected', () => {
    expect(selectionAfter(ids, null, 'next')).toBe('a');
    expect(selectionAfter(ids, 'gone', 'previous')).toBe('a');
  });

  it('selects nothing in an empty list', () => {
    expect(selectionAfter([], null, 'next')).toBeNull();
  });
});
