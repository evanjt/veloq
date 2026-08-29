/**
 * Scenario: the persisted query cache is restored before `AuthStore.initialize()`
 * finishes reading SecureStore, so no athlete id is known yet.
 * Expected behaviour: staleness is still detected, for either `includeStats` variant.
 */

import { QueryClient } from '@tanstack/react-query';
import { isInfiniteActivitiesStale } from '@/shared/query/activitiesCache';
import { queryKeys } from '@/shared/query/queryKeys';
import { useAuthStore } from '@/shared/app/AuthStore';
import { formatLocalDate } from '@/shared/format/format';

const today = formatLocalDate(new Date());

function seed(client: QueryClient, athleteId: string, includeStats: boolean, newest: string) {
  client.setQueryData(queryKeys.activities.infinite.byAthlete(athleteId, includeStats), {
    pages: [[]],
    pageParams: [{ newest, oldest: '2020-01-01' }],
  });
}

describe('isInfiniteActivitiesStale', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    useAuthStore.setState({ athleteId: null, isLoading: true });
  });

  afterEach(() => {
    client.clear();
  });

  it('detects yesterday page params before auth hydrates', () => {
    seed(client, 'i12345', false, '2020-06-01');
    expect(useAuthStore.getState().athleteId).toBeNull();
    expect(isInfiniteActivitiesStale(client)).toBe(true);
  });

  it('detects the stats variant, not just the base key', () => {
    seed(client, 'i12345', true, '2020-06-01');
    expect(isInfiniteActivitiesStale(client)).toBe(true);
  });

  it("is not stale when the first page already covers today's date", () => {
    seed(client, 'i12345', false, today);
    seed(client, 'i12345', true, today);
    expect(isInfiniteActivitiesStale(client)).toBe(false);
  });

  it('is not stale with nothing cached', () => {
    expect(isInfiniteActivitiesStale(client)).toBe(false);
  });

  it('still reports stale once auth hydrates with the same athlete', () => {
    seed(client, 'i12345', false, '2020-06-01');
    useAuthStore.setState({ athleteId: 'i12345', isLoading: false });
    expect(isInfiniteActivitiesStale(client)).toBe(true);
  });
});
