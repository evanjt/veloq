/**
 * LOCAL_READ_QUERY
 *
 * Scenario: the device is offline and an engine-only read throws once (a busy lock).
 * Expected behaviour: the retry runs and the read resolves, because a read of
 * on-device SQLite is not gated on connectivity. A default query pauses its retry.
 */

import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';

function offlineClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 2, retryDelay: 0, networkMode: 'offlineFirst' } },
  });
}

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

describe('LOCAL_READ_QUERY', () => {
  beforeEach(() => onlineManager.setOnline(false));
  afterEach(() => onlineManager.setOnline(true));

  it('retries a failed local read while offline', async () => {
    const client = offlineClient();
    const read = failOnce();
    const observer = new QueryObserver(client, {
      queryKey: ['local'],
      queryFn: read.fn,
      ...LOCAL_READ_QUERY,
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
    client.clear();
  });

  it('pauses the retry of a default query while offline', async () => {
    const client = offlineClient();
    const read = failOnce();
    const observer = new QueryObserver(client, { queryKey: ['remote'], queryFn: read.fn });
    const unsubscribe = observer.subscribe(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(read.calls()).toBe(1);
    expect(observer.getCurrentResult().fetchStatus).toBe('paused');
    unsubscribe();
    client.clear();
  });
});
