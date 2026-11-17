/**
 * Scenario: several panels of the connect page read the same phone method
 * with the same arguments, a write changes data some of them show, and the
 * athlete moves between pages while a read is on its way.
 *
 * Expected behaviour: two observers of one read send one request; a write
 * invalidates the reads it names and leaves the others; a read nobody watches
 * any more is cancelled; held data stays on screen while it is read again; a
 * method the phone does not list is a typed `unsupported` error and nothing is
 * sent; a reply that never comes is `timeout` and any other refusal `failed`.
 */

import { CancelledError, isCancelled, replyTimeout } from '../../../web/connect/link';
import {
  QueryClient,
  ReadError,
  readKey,
  type Transport,
  type ReadState,
} from '../../../web/connect/query';

type Sent = {
  method: string;
  params: object;
  signal: AbortSignal;
  slot?: string | undefined;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function phone(methods: string[] | null = ['feed.summary', 'strength.screen', 'strength.save']) {
  const sent: Sent[] = [];
  const transport: Transport = {
    methods: () => methods,
    ask: (method, params, options) =>
      new Promise((resolve, reject) => {
        sent.push({ method, params, signal: options.signal, slot: options.slot, resolve, reject });
      }),
  };
  return { sent, transport };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function watch(client: QueryClient, method: string, args: object) {
  const observation = client.observe(method, args);
  const states: ReadState<unknown>[] = [];
  const stop = observation.subscribe(() => states.push(observation.getSnapshot()));
  return { observation, states, stop };
}

describe('the read cache', () => {
  it('keys a read by its method and its arguments with the keys sorted', () => {
    expect(readKey('a.b', { x: 1, y: { q: 2, p: 3 } })).toBe(
      readKey('a.b', { y: { p: 3, q: 2 }, x: 1 })
    );
    expect(readKey('a.b', { x: 1 })).not.toBe(readKey('a.c', { x: 1 }));
    expect(readKey('a.b', { x: 1 })).not.toBe(readKey('a.b', { x: 2 }));
  });

  it('sends one request for two observers of the same read', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const first = watch(client, 'feed.summary', { days: 7 });
    const second = watch(client, 'feed.summary', { days: 7 });
    expect(sent).toHaveLength(1);
    sent[0].resolve({ total: 3 });
    await flush();
    expect(first.observation.getSnapshot().data).toEqual({ total: 3 });
    expect(second.observation.getSnapshot().data).toEqual({ total: 3 });
    expect(sent).toHaveLength(1);
  });

  it('sends a second request for other arguments', () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    watch(client, 'feed.summary', { days: 7 });
    watch(client, 'feed.summary', { days: 28 });
    expect(sent.map((ask) => ask.params)).toEqual([{ days: 7 }, { days: 28 }]);
  });

  it('answers a later observer from the held data without asking again', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const first = watch(client, 'feed.summary', {});
    sent[0].resolve('week');
    await flush();
    first.stop();
    const again = watch(client, 'feed.summary', {});
    expect(again.observation.getSnapshot().data).toBe('week');
    expect(again.observation.getSnapshot().loading).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('reports loading until the first answer and then holds the data', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'feed.summary', {});
    expect(observation.getSnapshot()).toMatchObject({
      data: undefined,
      loading: true,
      error: null,
    });
    sent[0].resolve('week');
    await flush();
    expect(observation.getSnapshot()).toMatchObject({
      data: 'week',
      loading: false,
      refreshing: false,
    });
  });

  it('keeps one snapshot object until the entry changes', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'feed.summary', {});
    expect(observation.getSnapshot()).toBe(observation.getSnapshot());
    const before = observation.getSnapshot();
    sent[0].resolve('week');
    await flush();
    expect(observation.getSnapshot()).not.toBe(before);
    expect(observation.getSnapshot()).toBe(observation.getSnapshot());
  });
});

describe('invalidation', () => {
  it('reads again what a write names and keeps the data on screen meanwhile', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', { days: 7 });
    sent[0].resolve('before');
    await flush();

    const write = client.write('strength.save', { id: 1 }, { invalidates: ['strength.screen'] });
    expect(sent[1].method).toBe('strength.save');
    sent[1].resolve({ saved: true });
    await write;
    expect(sent).toHaveLength(3);
    expect(sent[2].method).toBe('strength.screen');
    expect(observation.getSnapshot()).toMatchObject({
      data: 'before',
      refreshing: true,
      loading: false,
    });
    sent[2].resolve('after');
    await flush();
    expect(observation.getSnapshot()).toMatchObject({ data: 'after', refreshing: false });
  });

  it('leaves a read the write does not name alone', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    watch(client, 'feed.summary', {});
    sent[0].resolve('week');
    await flush();
    const write = client.write('strength.save', {}, { invalidates: ['strength.screen'] });
    sent[1].resolve(null);
    await write;
    expect(sent.map((ask) => ask.method)).toEqual(['feed.summary', 'strength.save']);
  });

  it('reads an unobserved entry again only when it is next observed', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const first = watch(client, 'strength.screen', {});
    sent[0].resolve('old');
    await flush();
    first.stop();
    client.invalidate(['strength.screen']);
    expect(sent).toHaveLength(1);
    const again = watch(client, 'strength.screen', {});
    expect(again.observation.getSnapshot()).toMatchObject({ data: 'old', refreshing: true });
    expect(sent).toHaveLength(2);
  });

  it('does not invalidate on a failed write and reports the failure', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    watch(client, 'strength.screen', {});
    sent[0].resolve('old');
    await flush();
    const write = client.write('strength.save', {}, { invalidates: ['strength.screen'] });
    sent[1].reject(new Error('phone is locked'));
    await expect(write).rejects.toMatchObject({ kind: 'failed' });
    expect(sent).toHaveLength(2);
  });

  it('drops a read in flight when it is invalidated and asks it again', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    client.invalidate(['strength.screen']);
    expect(sent[0].signal.aborted).toBe(true);
    expect(sent).toHaveLength(2);
    sent[0].resolve('late old answer');
    sent[1].resolve('new');
    await flush();
    expect(observation.getSnapshot().data).toBe('new');
  });

  it('a library change reads every watched entry again but not an activity stream', async () => {
    const { sent, transport } = phone(['feed.summary', 'activity.streams']);
    const client = new QueryClient(transport);
    watch(client, 'feed.summary', {});
    watch(client, 'activity.streams', { id: 'a1' });
    sent[0].resolve('week');
    sent[1].resolve('streams');
    await flush();
    client.changed();
    expect(sent.map((ask) => ask.method)).toEqual([
      'feed.summary',
      'activity.streams',
      'feed.summary',
    ]);
  });
});

describe('optimistic writes', () => {
  it('shows the change at once and keeps it when the write is answered', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    sent[0].resolve({ name: 'old' });
    await flush();
    const write = client.write(
      'strength.save',
      { name: 'new' },
      {
        optimistic: [{ method: 'strength.screen', args: {}, update: (_data, params) => params }],
      }
    );
    expect(observation.getSnapshot().data).toEqual({ name: 'new' });
    sent[1].resolve({});
    await write;
    expect(observation.getSnapshot().data).toEqual({ name: 'new' });
  });

  it('puts the held data back when the write fails', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    sent[0].resolve({ name: 'old' });
    await flush();
    const write = client.write(
      'strength.save',
      { name: 'new' },
      { optimistic: [{ method: 'strength.screen', args: {}, update: (_data, params) => params }] }
    );
    sent[1].reject(new Error('phone is locked'));
    await expect(write).rejects.toBeInstanceOf(ReadError);
    expect(observation.getSnapshot().data).toEqual({ name: 'old' });
  });

  it('offers an undo that sends the inverse write and reads again', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    watch(client, 'strength.screen', {});
    sent[0].resolve('old');
    await flush();
    const write = client.write(
      'strength.save',
      { id: 1 },
      {
        invalidates: ['strength.screen'],
        undo: () => ({ method: 'strength.save', params: { id: 0 } }),
      }
    );
    sent[1].resolve({});
    const outcome = await write;
    sent[2].resolve('after');
    await flush();
    expect(outcome.undo).not.toBeNull();
    const undone = outcome.undo!();
    expect(sent[3]).toMatchObject({ method: 'strength.save', params: { id: 0 } });
    sent[3].resolve({});
    await undone;
    expect(sent[4].method).toBe('strength.screen');
  });

  it('tells each listener a landed write with its notice and the undo it offers', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const events: unknown[] = [];
    client.onWrite((event) => events.push(event));
    const write = client.write(
      'strength.save',
      { id: 1 },
      {
        notice: 'connectPage.undo.hidden',
        undo: () => ({ method: 'strength.save', params: { id: 0 } }),
      }
    );
    sent[0].resolve({});
    const outcome = await write;
    expect(events).toEqual([
      {
        method: 'strength.save',
        notice: 'connectPage.undo.hidden',
        error: null,
        undo: outcome.undo,
      },
    ]);

    const undone = outcome.undo!();
    sent[1].resolve({});
    await undone;
    expect(events[1]).toEqual({
      method: 'strength.save',
      notice: undefined,
      error: null,
      undo: null,
    });
  });

  it('tells listeners a refused undo and rejects it', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const events: { error: unknown; method: string }[] = [];
    client.onWrite((event) => events.push(event as never));
    const write = client.write(
      'strength.save',
      { id: 1 },
      { undo: () => ({ method: 'strength.save', params: { id: 0 } }) }
    );
    sent[0].resolve({});
    const outcome = await write;
    const undone = outcome.undo!();
    sent[1].reject(new Error('phone is locked'));
    await expect(undone).rejects.toMatchObject({ kind: 'failed' });
    expect(events.at(-1)).toMatchObject({ method: 'strength.save' });
    expect(events.at(-1)?.error).toBeInstanceOf(Error);
  });
});

describe('cancellation', () => {
  it('cancels a read when its last observer goes', () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const first = watch(client, 'strength.screen', {});
    const second = watch(client, 'strength.screen', {});
    first.stop();
    expect(sent[0].signal.aborted).toBe(false);
    second.stop();
    expect(sent[0].signal.aborted).toBe(true);
  });

  it('asks again when the page comes back after a cancelled read', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    watch(client, 'strength.screen', {}).stop();
    sent[0].reject(new DOMException('cancelled', 'AbortError'));
    await flush();
    const again = watch(client, 'strength.screen', {});
    expect(sent).toHaveLength(2);
    sent[1].resolve('shown');
    await flush();
    expect(again.observation.getSnapshot().data).toBe('shown');
  });

  it('does not report a cancelled read as an error', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation, stop } = watch(client, 'strength.screen', {});
    stop();
    sent[0].reject(new DOMException('cancelled', 'AbortError'));
    await flush();
    expect(observation.getSnapshot().error).toBeNull();
  });
});

describe('typed errors', () => {
  it('is unsupported, and sends nothing, for a method the phone does not list', () => {
    const { sent, transport } = phone(['feed.summary']);
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    const state = observation.getSnapshot();
    expect(state.error).toMatchObject({ kind: 'unsupported', method: 'strength.screen' });
    expect(state.loading).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('answers unsupported before the first render subscribes', () => {
    const { transport } = phone(['feed.summary']);
    const observation = new QueryClient(transport).observe('strength.screen', {});
    expect(observation.getSnapshot().error?.kind).toBe('unsupported');
  });

  it('is timeout when the phone does not reply in time', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    sent[0].reject(replyTimeout(30));
    await flush();
    expect(observation.getSnapshot().error).toMatchObject({ kind: 'timeout' });
  });

  it('is failed for any other refusal, and keeps data it held', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    sent[0].resolve('held');
    await flush();
    client.invalidate(['strength.screen']);
    sent[1].reject(new Error('engine error'));
    await flush();
    expect(observation.getSnapshot()).toMatchObject({
      data: 'held',
      error: { kind: 'failed' },
      refreshing: false,
    });
  });

  it('asks again on retry', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    sent[0].reject(new Error('engine error'));
    await flush();
    client.retry('strength.screen', {});
    expect(sent).toHaveLength(2);
    sent[1].resolve('shown');
    await flush();
    expect(observation.getSnapshot()).toMatchObject({ data: 'shown', error: null });
  });
});

describe('the connection', () => {
  it('forgets everything on a drop and cancels what is in flight', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    client.reset();
    expect(sent[0].signal.aborted).toBe(true);
    sent[0].resolve('from the old link');
    await flush();
    expect(observation.getSnapshot().data).toBeUndefined();
  });

  it('keeps held answers on a disconnect, cancels what is in flight and asks again on connected', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    sent[0].resolve('shown');
    await flush();
    client.invalidate(['strength.screen']);
    expect(sent).toHaveLength(2);

    client.disconnected();
    expect(sent[1].signal.aborted).toBe(true);
    expect(observation.getSnapshot()).toMatchObject({ data: 'shown', refreshing: false });
    expect(sent).toHaveLength(2);

    client.connected();
    expect(sent).toHaveLength(3);
    expect(observation.getSnapshot()).toMatchObject({ data: 'shown', refreshing: true });
    sent[2].resolve('live');
    await flush();
    expect(observation.getSnapshot()).toMatchObject({
      data: 'live',
      refreshing: false,
      loading: false,
    });
  });

  it('asks a held answer again after a disconnect even when nothing was in flight', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    sent[0].resolve('shown');
    await flush();
    client.disconnected();
    client.connected();
    expect(sent).toHaveLength(2);
    expect(observation.getSnapshot()).toMatchObject({ data: 'shown', refreshing: true });
  });

  it('waits for the phone to list its methods and then asks', () => {
    let listed: string[] | null = null;
    const sent: string[] = [];
    const transport: Transport = {
      methods: () => listed,
      ask: (method) => {
        sent.push(method);
        return new Promise(() => undefined);
      },
    };
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    expect(sent).toHaveLength(0);
    expect(observation.getSnapshot().loading).toBe(true);
    listed = ['strength.screen'];
    client.connected();
    expect(sent).toEqual(['strength.screen']);
  });

  it('passes the slot to the transport, which withdraws an older ask in it', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    void client.fetch('strength.screen', { days: 7 }, { slot: 'screen' });
    void client.fetch('strength.screen', { days: 28 }, { slot: 'screen' });
    expect(sent.map((ask) => ask.slot)).toEqual(['screen', 'screen']);
  });

  it('serves an imperative fetch from the cache and shares it with observers', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const { observation } = watch(client, 'strength.screen', {});
    const fetched = client.fetch('strength.screen', {});
    expect(sent).toHaveLength(1);
    sent[0].resolve('shown');
    await expect(fetched).resolves.toBe('shown');
    await expect(client.fetch('strength.screen', {})).resolves.toBe('shown');
    expect(sent).toHaveLength(1);
    expect(observation.getSnapshot().data).toBe('shown');
  });

  it('rejects a fetch withdrawn by an invalidation as cancelled, not as a failure, and asks again for the next', async () => {
    const { sent, transport } = phone();
    const client = new QueryClient(transport);
    const fetched = client.fetch('strength.screen', {});
    const outcome = fetched.then(
      () => null,
      (error: unknown) => error
    );
    client.invalidate(['strength.screen']);
    sent[0].reject(new CancelledError());
    const error = await outcome;
    expect(isCancelled(error)).toBe(true);
    expect(error).not.toBeInstanceOf(ReadError);
    const again = client.fetch('strength.screen', {});
    sent[sent.length - 1].resolve('new');
    await expect(again).resolves.toBe('new');
  });

  it('rejects an imperative fetch of an unlisted method as unsupported', async () => {
    const { transport } = phone(['feed.summary']);
    await expect(new QueryClient(transport).fetch('strength.screen', {})).rejects.toMatchObject({
      kind: 'unsupported',
    });
  });
});

describe('a fetch before the phone lists its methods', () => {
  it('waits for the list and then resolves with the answer, rather than failing as not connected', async () => {
    let listed: string[] | null = null;
    const sent: Sent[] = [];
    const client = new QueryClient({
      methods: () => listed,
      ask: (method, params, options) =>
        new Promise((resolve, reject) => {
          sent.push({
            method,
            params,
            signal: options.signal,
            slot: options.slot,
            resolve,
            reject,
          });
        }),
    });
    const settled = jest.fn();
    const answer = client.fetch('geo.track', { id: 'a1' }).then(settled, settled);
    await flush();
    expect(sent).toHaveLength(0);
    expect(settled).not.toHaveBeenCalled();

    listed = ['geo.track'];
    client.connected();
    await flush();
    expect(sent.map((one) => one.method)).toEqual(['geo.track']);
    sent[0]!.resolve({ text: 'line' });
    await answer;
    expect(settled).toHaveBeenCalledWith({ text: 'line' });
  });

  it('is typed unsupported when the list arrives without the method', async () => {
    let listed: string[] | null = null;
    const client = new QueryClient({ methods: () => listed, ask: () => new Promise(() => {}) });
    const answer = client.fetch('geo.track', { id: 'a1' });
    listed = ['feed.summary'];
    client.connected();
    await expect(answer).rejects.toMatchObject({ kind: 'unsupported' });
  });
});
