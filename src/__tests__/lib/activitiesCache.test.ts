/**
 * Scenario: the persisted query cache is restored before `AuthStore.initialize()`
 * finishes reading SecureStore, so no athlete id is known yet.
 * Expected behaviour: staleness is still detected without one.
 */

import { QueryClient } from '@tanstack/react-query';
import { isInfiniteActivitiesStale } from '@/shared/query/activitiesCache';
import { queryKeys } from '@/shared/query/queryKeys';
import { useAuthStore } from '@/shared/app/AuthStore';
import { formatLocalDate } from '@/shared/format/format';

const today = formatLocalDate(new Date());

function seed(client: QueryClient, athleteId: string, newest: string) {
  client.setQueryData(queryKeys.activities.infinite.byAthlete(athleteId), {
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
    seed(client, 'i12345', '2020-06-01');
    expect(useAuthStore.getState().athleteId).toBeNull();
    expect(isInfiniteActivitiesStale(client)).toBe(true);
  });

  it('detects a stale feed cached under another athlete', () => {
    seed(client, 'i99999', '2020-06-01');
    expect(isInfiniteActivitiesStale(client)).toBe(true);
  });

  it("is not stale when the first page already covers today's date", () => {
    seed(client, 'i12345', today);
    expect(isInfiniteActivitiesStale(client)).toBe(false);
  });

  it('is not stale with nothing cached', () => {
    expect(isInfiniteActivitiesStale(client)).toBe(false);
  });

  it('still reports stale once auth hydrates with the same athlete', () => {
    seed(client, 'i12345', '2020-06-01');
    useAuthStore.setState({ athleteId: 'i12345', isLoading: false });
    expect(isInfiniteActivitiesStale(client)).toBe(true);
  });
});
