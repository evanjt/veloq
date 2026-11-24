/**
 * Scenario: the feed is a sortable table whose filters, sort and selection
 * live in the hash query and whose rows are stepped with the keyboard.
 *
 * Expected behaviour: a sort keeps rows with no value last in either
 * direction; the hash query round-trips range, sport, sort, filter text and selection;
 * a range preset names the same days the phone's does; the arrow keys move the
 * selection within the loaded rows and stop at the ends.
 */

import {
  COLUMNS,
  columnsForWidth,
  feedQuery,
  readFeedQuery,
  rangeBounds,
  selectionAfter,
  sortRows,
  type Row,
} from '../../../web/connect/table';
import { parse, write } from '../../../web/connect/router';
import { atUtcOffset } from '../__shared__/fixedOffsetDate';

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

  vaultIt('orders text without regard to case and leaves the input alone', () => {
    const named = [row('1', { name: 'beta' }), row('2', { name: 'Alpha' })];
    expect(sortRows(named, { column: 'name', dir: 'asc' }).map((r) => r.id)).toEqual(['2', '1']);
    expect(named.map((r) => r.id)).toEqual(['1', '2']);
  });

  vaultIt('keeps the loaded order when no sort is chosen', () => {
    expect(sortRows(rows, null)).toEqual(rows);
  });

  vaultIt('has every column the table shows', () => {
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

const empty = {
  range: null,
  families: [],
  sort: null,
  id: null,
  ids: [],
  search: '',
  minDistance: null,
  maxDistance: null,
  minMovingTime: null,
  maxMovingTime: null,
};

describe('the hash query', () => {
  vaultIt('round-trips range, sport, sort and selection', () => {
    const state = {
      range: 'thisYear' as const,
      families: ['ride' as const, 'run' as const],
      sort: { column: 'load' as const, dir: 'desc' as const },
      id: 'i 42',
      ids: [] as string[],
      search: 'hill & climb',
      minDistance: 5000,
      maxDistance: 42195.5,
      minMovingTime: 1800,
      maxMovingTime: 7200,
    };
    const hash = write({ screen: 'activities', id: null, query: feedQuery(state) });
    expect(readFeedQuery(parse(hash))).toEqual(state);
  });

  vaultIt('reads an empty query as no range, no sport, no sort and nothing selected', () => {
    expect(readFeedQuery(parse('#/activities'))).toEqual({
      range: null,
      families: [],
      sort: null,
      id: null,
      ids: [],
      search: '',
      minDistance: null,
      maxDistance: null,
      minMovingTime: null,
      maxMovingTime: null,
    });
  });

  vaultIt('ignores a range, a sport or a sort it does not know', () => {
    const got = readFeedQuery(parse('#/activities?range=never&sport=ride,quad&sort=nope:asc'));
    expect(got).toEqual({
      range: null,
      families: ['ride'],
      sort: null,
      id: null,
      ids: [],
      search: '',
      minDistance: null,
      maxDistance: null,
      minMovingTime: null,
      maxMovingTime: null,
    });
    expect(readFeedQuery(parse('#/activities?sort=name:sideways')).sort).toBeNull();
  });

  vaultIt('ignores a bound that is not a positive number', () => {
    const got = readFeedQuery(
      parse('#/activities?minDistance=abc&maxDistance=-5&minMovingTime=0&maxMovingTime=')
    );
    expect(got.minDistance).toBeNull();
    expect(got.maxDistance).toBeNull();
    expect(got.minMovingTime).toBeNull();
    expect(got.maxMovingTime).toBeNull();
  });

  vaultIt('writes only the bounds that are set', () => {
    expect(feedQuery({ ...empty, minDistance: 1000, maxMovingTime: 60 })).toEqual([
      ['minDistance', '1000'],
      ['maxMovingTime', '60'],
    ]);
  });

  vaultIt('writes nothing for the defaults', () => {
    expect(feedQuery({ ...empty, search: '' })).toEqual([]);
    expect(feedQuery({ ...empty, search: '  ' })).toEqual([]);
  });
});

describe('rangeBounds', () => {
  const today = new Date(2026, 10, 12, 15, 30);
  const secs = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
    Date.UTC(y, m, d, h, min, s) / 1000;

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

  vaultIt('is unbounded with no preset', () => {
    expect(rangeBounds(null, today)).toEqual({ oldestTs: null, newestTs: null });
  });
});

describe('selectionAfter', () => {
  const ids = ['a', 'b', 'c'];

  vaultIt('steps down and up within the rows', () => {
    expect(selectionAfter(ids, 'a', 'next')).toBe('b');
    expect(selectionAfter(ids, 'c', 'previous')).toBe('b');
  });

  vaultIt('stops at the ends', () => {
    expect(selectionAfter(ids, 'c', 'next')).toBe('c');
    expect(selectionAfter(ids, 'a', 'previous')).toBe('a');
  });

  vaultIt('starts at the first row when nothing, or a row no longer loaded, is selected', () => {
    expect(selectionAfter(ids, null, 'next')).toBe('a');
    expect(selectionAfter(ids, 'gone', 'previous')).toBe('a');
  });

  vaultIt('selects nothing in an empty list', () => {
    expect(selectionAfter([], null, 'next')).toBeNull();
  });
});

describe('columnsForWidth', () => {
  it('shows six columns on a narrow window, adds climb from 1280 and every column from 1600', () => {
    expect(columnsForWidth(1024)).toEqual(['date', 'name', 'sport', 'distance', 'time', 'load']);
    expect(columnsForWidth(1280)).toEqual([
      'date',
      'name',
      'sport',
      'distance',
      'time',
      'climb',
      'load',
    ]);
    expect(columnsForWidth(1599)).toHaveLength(7);
    expect(columnsForWidth(1600)).toEqual(COLUMNS.map((c) => c.key));
    expect(columnsForWidth(2560)).toEqual(COLUMNS.map((c) => c.key));
  });
});

describe('rangeBounds off the UTC clock', () => {
  const utc = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
    Date.UTC(y, m, d, h, min, s) / 1000;

  it.each([10, -5])(
    'names whole calendar days in the engine date space at UTC%+d',
    (offsetHours) => {
      const bounds = atUtcOffset(offsetHours, () => {
        const today = new Date(2026, 10, 12, 21, 30);
        return {
          last90Days: rangeBounds('last90Days', today),
          thisYear: rangeBounds('thisYear', today),
          lastYear: rangeBounds('lastYear', today),
        };
      });
      expect(bounds.last90Days).toEqual({
        oldestTs: utc(2026, 10, 12 - 89),
        newestTs: utc(2026, 10, 12, 23, 59, 59),
      });
      expect(bounds.thisYear).toEqual({
        oldestTs: utc(2026, 0, 1),
        newestTs: utc(2026, 10, 12, 23, 59, 59),
      });
      expect(bounds.lastYear).toEqual({
        oldestTs: utc(2025, 0, 1),
        newestTs: utc(2025, 11, 31, 23, 59, 59),
      });
    }
  );
});
