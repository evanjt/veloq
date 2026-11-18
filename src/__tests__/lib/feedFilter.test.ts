/**
 * Scenario: the feed's filters are additive, and a distance or a duration range
 * narrows the feed as a sport chip or a date range does.
 *
 * Expected behaviour: a distance range alone makes the feed a search read, a
 * duration range alone makes it filtered, and the chip row names each filter set
 * in its fixed order and drops each one cleared.
 */

import {
  feedFilterBoundsQuery,
  feedFilterChips,
  isFeedFiltered,
  isFeedSearch,
  numericRangeFor,
  type FeedFilter,
} from '@/features/activity/lib/feedFilter';

const NONE: FeedFilter = {
  searchText: '',
  groups: new Set(),
  range: null,
  distance: null,
  duration: null,
};

const FORMAT = {
  date: (range: { oldest: string; newest: string }) => `${range.oldest}..${range.newest}`,
  distance: (range: { low: number; high: number }) => `${range.low}-${range.high} m`,
  duration: (range: { low: number; high: number }) => `${range.low}-${range.high} s`,
  sport: (group: string) => group,
};

describe('isFeedSearch and isFeedFiltered', () => {
  it('reads nothing as unfiltered', () => {
    expect(isFeedSearch(NONE)).toBe(false);
    expect(isFeedFiltered(NONE)).toBe(false);
  });

  it('lists the feed through the search read for a distance range alone', () => {
    const filter = { ...NONE, distance: { low: 20_000, high: 60_000 } };
    expect(isFeedSearch(filter)).toBe(true);
    expect(isFeedFiltered(filter)).toBe(true);
  });

  it('lists the feed through the search read for a duration range alone', () => {
    const filter = { ...NONE, duration: { low: 3_600, high: 10_800 } };
    expect(isFeedSearch(filter)).toBe(true);
    expect(isFeedFiltered(filter)).toBe(true);
  });

  it('keeps a date range on its own windowed read', () => {
    const filter = { ...NONE, range: { oldest: '2026-03-12', newest: '2026-06-04' } };
    expect(isFeedSearch(filter)).toBe(false);
    expect(isFeedFiltered(filter)).toBe(true);
  });

  it('treats a blank name as no name', () => {
    expect(isFeedFiltered({ ...NONE, searchText: '   ' })).toBe(false);
  });
});

describe('feedFilterChips', () => {
  const all: FeedFilter = {
    searchText: ' Hill ',
    groups: new Set(['Run', 'Ride'] as const),
    range: { oldest: '2026-03-12', newest: '2026-06-04' },
    distance: { low: 20_000, high: 60_000 },
    duration: { low: 3_600, high: 10_800 },
  };

  it('lists date, distance, duration, sport and name in the row order', () => {
    expect(feedFilterChips(all, FORMAT)).toEqual([
      { kind: 'date', label: '2026-03-12..2026-06-04' },
      { kind: 'distance', label: '20000-60000 m' },
      { kind: 'duration', label: '3600-10800 s' },
      { kind: 'sport', label: 'Ride', group: 'Ride' },
      { kind: 'sport', label: 'Run', group: 'Run' },
      { kind: 'name', label: 'Hill' },
    ]);
  });

  it('drops each chip once its filter is cleared', () => {
    expect(feedFilterChips({ ...all, range: null }, FORMAT).map((c) => c.kind)).toEqual([
      'distance',
      'duration',
      'sport',
      'sport',
      'name',
    ]);
    expect(feedFilterChips({ ...all, distance: null }, FORMAT).map((c) => c.kind)).not.toContain(
      'distance'
    );
    expect(feedFilterChips({ ...all, duration: null }, FORMAT).map((c) => c.kind)).not.toContain(
      'duration'
    );
    expect(feedFilterChips({ ...all, groups: new Set() }, FORMAT).map((c) => c.kind)).not.toContain(
      'sport'
    );
    expect(feedFilterChips({ ...all, searchText: '  ' }, FORMAT).map((c) => c.kind)).not.toContain(
      'name'
    );
    expect(feedFilterChips(NONE, FORMAT)).toEqual([]);
  });
});

describe('numericRangeFor', () => {
  const bounds = { min: 1_000, max: 100_000 };

  it('is no filter while both handles rest on the library span', () => {
    expect(numericRangeFor(1_000, 100_000, bounds)).toBeNull();
  });

  it('is a filter once either handle leaves its end', () => {
    expect(numericRangeFor(5_000, 100_000, bounds)).toEqual({ low: 5_000, high: 100_000 });
    expect(numericRangeFor(1_000, 80_000, bounds)).toEqual({ low: 1_000, high: 80_000 });
  });
});

describe('feedFilterBoundsQuery', () => {
  it('passes no bound for no range', () => {
    expect(feedFilterBoundsQuery(NONE)).toEqual({});
  });

  it('maps distance to metres and duration to moving seconds', () => {
    expect(
      feedFilterBoundsQuery({
        ...NONE,
        distance: { low: 20_000, high: 60_000 },
        duration: { low: 3_600, high: 10_800 },
      })
    ).toEqual({
      minDistance: 20_000,
      maxDistance: 60_000,
      minMovingTime: 3_600,
      maxMovingTime: 10_800,
    });
  });
});
