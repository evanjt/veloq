/**
 * Scenario: the feed's search runs on the device first, and the account is
 * offered once that search has nothing more to show.
 *
 * Expected behaviour: the offer needs a name or a date range, a settled local
 * read with no further page, and no failure. The question sent to the account
 * is the feed's own filter, with the date range as the days it names.
 */

import { FfiSportFamily } from 'veloqrs';

import type { FeedFilter } from '../feedFilter';
import {
  canSearchAccount,
  remoteSearchKey,
  remoteSearchQuery,
  shouldOfferRemoteSearch,
} from '../remoteSearch';

jest.mock('veloqrs', () => require('../../../../__tests__/__shared__/veloqrsStub').withOverrides());

const NONE: FeedFilter = {
  searchText: '',
  groups: new Set(),
  range: null,
  distance: null,
  duration: null,
};

const settled = {
  searchable: true,
  loading: false,
  hasMore: false,
  fetchingMore: false,
  failed: false,
};

describe('shouldOfferRemoteSearch', () => {
  it('offers nothing when the held source has no search, however the local list ends', () => {
    expect(
      shouldOfferRemoteSearch({
        filter: { ...NONE, searchText: 'ferry' },
        ...settled,
        searchable: false,
      })
    ).toBe(false);
  });

  it('offers once a name is set and the local list has run out', () => {
    expect(
      shouldOfferRemoteSearch({ filter: { ...NONE, searchText: ' ferry ' }, ...settled })
    ).toBe(true);
  });

  it('offers for a date range with no name', () => {
    const range = { oldest: '2024-03-01', newest: '2024-03-31' };
    expect(shouldOfferRemoteSearch({ filter: { ...NONE, range }, ...settled })).toBe(true);
  });

  it('offers nothing for a sport or a size alone, which the account cannot be asked', () => {
    const sport = { ...NONE, groups: new Set(['Ride' as const]) };
    const size = { ...NONE, distance: { low: 1000, high: 5000 } };
    expect(shouldOfferRemoteSearch({ filter: sport, ...settled })).toBe(false);
    expect(shouldOfferRemoteSearch({ filter: size, ...settled })).toBe(false);
  });

  it('offers nothing with no filter or a blank name', () => {
    expect(shouldOfferRemoteSearch({ filter: NONE, ...settled })).toBe(false);
    expect(shouldOfferRemoteSearch({ filter: { ...NONE, searchText: '   ' }, ...settled })).toBe(
      false
    );
  });

  it.each([
    ['while the first page loads', { loading: true }],
    ['while a further page exists', { hasMore: true }],
    ['while a further page loads', { fetchingMore: true }],
    ['after the local read failed', { failed: true }],
  ])('holds the offer back %s', (_when, state) => {
    expect(
      shouldOfferRemoteSearch({ filter: { ...NONE, searchText: 'ferry' }, ...settled, ...state })
    ).toBe(false);
  });
});

describe('remoteSearchQuery', () => {
  it('sends the trimmed name, the engine sport families and the size bounds', () => {
    const query = remoteSearchQuery({
      ...NONE,
      searchText: ' ferry ',
      groups: new Set(['Ride' as const]),
      distance: { low: 10_000, high: 50_000 },
      duration: { low: 1_800, high: 7_200 },
    });

    expect(query).toEqual({
      needle: 'ferry',
      sportFamilies: [FfiSportFamily.Ride],
      minDistance: 10_000,
      maxDistance: 50_000,
      minMovingTime: 1_800,
      maxMovingTime: 7_200,
    });
  });

  it('turns a range into the epoch seconds of its first and last day, inclusive', () => {
    const query = remoteSearchQuery({
      ...NONE,
      range: { oldest: '2024-03-01', newest: '2024-03-31' },
    });

    expect(query.needle).toBe('');
    expect(query.oldestTs).toBe(Date.UTC(2024, 2, 1) / 1000);
    expect(query.newestTs).toBe(Date.UTC(2024, 3, 1) / 1000 - 1);
  });
});

describe('canSearchAccount and remoteSearchKey', () => {
  it('moves the key with the question, so an answer is not shown under another', () => {
    const a = remoteSearchKey({ ...NONE, searchText: 'ferry' });
    expect(remoteSearchKey({ ...NONE, searchText: 'ferry ' })).toBe(a);
    expect(remoteSearchKey({ ...NONE, searchText: 'harbour' })).not.toBe(a);
    expect(canSearchAccount({ ...NONE, searchText: 'x' })).toBe(true);
  });
});
