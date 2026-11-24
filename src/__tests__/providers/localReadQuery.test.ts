/**
 * Query client network mode
 *
 * Scenario: the device is offline and an engine read throws once (a busy lock).
 * Expected behaviour: a query that sets no options of its own retries and
 * resolves, because every queryFn in the app reads on-device SQLite and is not
 * gated on connectivity. The app has no mutation and no query that fetches.
 */

import { QueryObserver, onlineManager } from '@tanstack/react-query';
import { queryClient } from '@/shared/query/QueryProvider';

function failOnce() {
  let calls = 0;
  return {
    fn: async () => {
      calls += 1;
      if (calls === 1) throw new Error('database is locked');
      return 'rows';
    },
    calls: () => calls,
  };
}

describe('query client default network mode', () => {
  beforeEach(() => {
    queryClient.clear();
    onlineManager.setOnline(false);
  });
  afterEach(() => {
    onlineManager.setOnline(true);
    queryClient.clear();
  });

  it('retries a failed read while the online manager says offline', async () => {
    const read = failOnce();
    const observer = new QueryObserver(queryClient, {
      queryKey: ['local'],
      queryFn: read.fn,
      retryDelay: 0,
    });
    const result = await new Promise<string>((resolve, reject) => {
      const unsubscribe = observer.subscribe((r) => {
        if (r.status === 'success') {
          unsubscribe();
          resolve(r.data as string);
        } else if (r.status === 'error') {
          unsubscribe();
          reject(r.error);
        }
      });
    });
    expect(result).toBe('rows');
    expect(read.calls()).toBe(2);
  });

  it('runs the first attempt of a read while offline', async () => {
    const data = await queryClient.fetchQuery({ queryKey: ['first'], queryFn: async () => 7 });
    expect(data).toBe(7);
  });
});
