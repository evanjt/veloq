// What a view reads the phone through: `useRead` for one read, `useReads` for
// several asked together, `useWrite` for a write. Each is a window on the
// query client in context, so a view holds no copy of what the phone answered.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  QueryClient,
  type ReadError,
  type ReadState,
  type WriteOptions,
  type WriteOutcome,
} from './query';
import type { Methods } from './schema';

const QueryContext = createContext<QueryClient | null>(null);

export function QueryProvider({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryContext.Provider value={client}>{children}</QueryContext.Provider>;
}

export function useQueries(): QueryClient {
  const client = useContext(QueryContext);
  if (!client) throw new Error('no-query-provider');
  return client;
}

const IDLE: ReadState<never> = { data: undefined, loading: false, refreshing: false, error: null };

export type Read<T> = ReadState<T> & {
  /** Ask this read again, after a failure. */
  retry: () => void;
};

/**
 * One read of the phone. With `null` arguments nothing is asked and the state
 * is idle, so a read that waits on a choice is written in place.
 */
export function useRead<M extends keyof Methods>(
  method: M,
  args: Methods[M]['params'] | null
): Read<Methods[M]['result']> {
  const client = useQueries();
  const key = args === null ? null : JSON.stringify(args);
  const observation = useMemo(
    () => (args === null ? null : client.observe(method, args)),
    // The arguments are compared by value: a new object for the same read is the same read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, method, key]
  );
  const state = useSyncExternalStore(
    observation?.subscribe ?? NO_SUBSCRIBE,
    observation?.getSnapshot ?? NO_SNAPSHOT
  ) as ReadState<Methods[M]['result']>;
  const retry = useCallback(() => {
    if (args !== null) client.retry(method, args);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, method, key]);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}

const NO_SUBSCRIBE = () => () => undefined;
const NO_SNAPSHOT = () => IDLE;

export type AskSpec = { method: string; args: object } | null;

/** Several reads watched together, one state each in the order asked. */
export function useReads(asks: readonly AskSpec[]): readonly ReadState<unknown>[] {
  const client = useQueries();
  const key = JSON.stringify(asks);
  const observation = useMemo(
    () => client.observeMany(asks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, key]
  );
  return useSyncExternalStore(observation.subscribe, observation.getSnapshot);
}

export type Write = {
  /** Send the write. Rejects with a typed `ReadError` when the phone refuses it. */
  run: <M extends keyof Methods>(
    method: M,
    params: Methods[M]['params'],
    options?: WriteOptions
  ) => Promise<WriteOutcome<Methods[M]['result']>>;
  pending: boolean;
  error: ReadError | null;
};

/** Writes to the phone: the reads each names are read again when it answers. */
export function useWrite(): Write {
  const client = useQueries();
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<ReadError | null>(null);
  const run = useCallback<Write['run']>(
    async (method, params, options) => {
      setPending((count) => count + 1);
      try {
        const outcome = await client.write(method, params, options);
        setError(null);
        return outcome;
      } catch (failure) {
        setError(failure as ReadError);
        throw failure;
      } finally {
        setPending((count) => count - 1);
      }
    },
    [client]
  );
  return { run, pending: pending > 0, error };
}
