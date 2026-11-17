// The one place the page reads the phone. A read is named by its method and
// its arguments, and everything asking the same read shares one entry: one
// request in flight, one answer held. An entry stays on screen while it is
// read again, a read nobody watches is cancelled, and a failure is a typed
// error the panel that asked draws in place. It holds no DOM and no React, only
// the transport it is given, so a test drives it with a stand-in.

import type { ParseKeys } from 'i18next';

import { NOT_CONNECTED } from './connection';
import { CancelledError, isCancelled, isReplyTimeout, isSuperseded } from './link';
import type { Methods } from './schema';

/** What an error says went wrong, so the panel can word it. */
export type ReadErrorKind = 'unsupported' | 'timeout' | 'failed';

export class ReadError extends Error {
  constructor(
    readonly kind: ReadErrorKind,
    readonly method: string,
    detail?: string
  ) {
    super(detail ?? `${method}: ${kind}`);
    this.name = 'ReadError';
  }
}

export function isReadError(error: unknown): error is ReadError {
  return error instanceof ReadError;
}

/** What the query layer needs of the link client. */
export interface Transport {
  /** The methods the phone lists, or null before its hello is read. */
  methods: () => readonly string[] | null;
  /**
   * Ask one method. `signal` aborting withdraws the ask, and `slot` withdraws
   * an earlier ask still outstanding in the same slot.
   */
  ask: (
    method: string,
    params: object,
    options: { signal: AbortSignal; slot?: string }
  ) => Promise<unknown>;
}

/** What a panel draws for one read. */
export type ReadState<T> = {
  data: T | undefined;
  /** No answer held yet and one on its way. */
  loading: boolean;
  /** An answer held and a newer one on its way. */
  refreshing: boolean;
  /** Why the last ask failed, with any older answer still in `data`. */
  error: ReadError | null;
};

/** Which reads an invalidation names: methods by name, or a test of the method and arguments. */
export type Matcher = readonly string[] | ((method: string, args: object) => boolean);

export type Optimistic = {
  method: string;
  args: object;
  /** The data to show while the write is out, from what is held and the write's parameters. */
  update: (held: never, params: never) => unknown;
};

export type WriteOptions = {
  /** The reads to ask again once the phone answers the write. */
  invalidates?: Matcher;
  optimistic?: readonly Optimistic[];
  /** The write that puts things back, from the write's parameters and its result. */
  undo?: (
    params: never,
    result: never
  ) => { method: string; params: object; invalidates?: Matcher };
  /** What the page says once the phone answers, with the undo when the write offers one. */
  notice?: ParseKeys;
};

export type WriteOutcome<R> = {
  result: R;
  /** Sends the inverse write, or null when the write named none. */
  undo: (() => Promise<void>) | null;
};

/** A write the phone answered or refused, or an undo sent. Each listener is told every one. */
export type WriteEvent = {
  method: string;
  /** What the page says for it, when the write asked for a notice. */
  notice: ParseKeys | undefined;
  /** Null when the phone answered; the refusal otherwise. */
  error: unknown | null;
  /** Sends the undo of an answered write, or null when it offers none. */
  undo: (() => Promise<void>) | null;
};

/** Methods whose answer for an id never changes once stored. */
const STABLE_METHODS = new Set(['activity.streams', 'activity.track']);
/** Entries nothing watches that are kept for the next visit, the oldest dropped past it. */
const UNWATCHED_LIMIT = 200;

/** Every read but an activity's stored series: what a write that names nothing reads again. */
export const UNLESS_STORED: Matcher = (method) => !STABLE_METHODS.has(method);

/** The key an ask is held under: the method and its arguments with keys sorted. */
export function readKey(method: string, args: object): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, inner]) => [key, sorted(inner)])
          )
        : value;
  return `${method} ${JSON.stringify(sorted(args))}`;
}

/** How an error from the transport is told to the panel. */
export function classify(method: string, error: unknown): ReadError {
  if (error instanceof ReadError) return error;
  if (isReplyTimeout(error)) return new ReadError('timeout', method, (error as Error).message);
  return new ReadError('failed', method, error instanceof Error ? error.message : String(error));
}

/** An ask withdrawn on purpose is not a failure. */
function isQuiet(error: unknown): boolean {
  return (
    isCancelled(error) ||
    isSuperseded(error) ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

type Entry = {
  key: string;
  method: string;
  args: object;
  data: unknown;
  hasData: boolean;
  error: ReadError | null;
  /** Held data that a newer answer is owed to. */
  stale: boolean;
  inflight: { controller: AbortController; promise: Promise<unknown> } | null;
  /** Views watching this entry. */
  observers: number;
  /** Imperative fetches waiting on the entry's ask. */
  waiters: number;
  state: ReadState<unknown>;
  listeners: Set<() => void>;
  slot?: string;
};

export type Observation<T> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
};

export class QueryClient {
  private entries = new Map<string, Entry>();
  private writeListeners = new Set<(event: WriteEvent) => void>();
  /** Fetches issued before the phone listed its methods, released by `connected`. */
  private listWaiters = new Set<() => void>();

  constructor(private readonly transport: Transport) {}

  /** Tell `listener` each write the phone answers or refuses, and each undo sent. */
  onWrite(listener: (event: WriteEvent) => void): () => void {
    this.writeListeners.add(listener);
    return () => {
      this.writeListeners.delete(listener);
    };
  }

  /** The read as the panel draws it, and a way to watch it for changes. */
  observe<M extends keyof Methods>(
    method: M,
    args: Methods[M]['params']
  ): Observation<ReadState<Methods[M]['result']>>;
  observe(method: string, args: object): Observation<ReadState<unknown>>;
  observe(method: string, args: object): Observation<ReadState<unknown>> {
    const entry = this.entry(method, args);
    return {
      subscribe: (listener) => {
        const current = this.entries.get(entry.key) === entry ? entry : this.entry(method, args);
        current.listeners.add(listener);
        current.observers++;
        this.start(current);
        let done = false;
        return () => {
          if (done) return;
          done = true;
          current.listeners.delete(listener);
          current.observers--;
          this.release(current);
        };
      },
      getSnapshot: () => (this.entries.get(entry.key) ?? entry).state,
    };
  }

  /** Several reads watched together; the snapshot changes only when one of them does. */
  observeMany(
    asks: readonly ({ method: string; args: object } | null)[]
  ): Observation<readonly ReadState<unknown>[]> {
    const idle: ReadState<unknown> = {
      data: undefined,
      loading: false,
      refreshing: false,
      error: null,
    };
    const each = asks.map((ask) => (ask ? this.observe(ask.method, ask.args) : null));
    let last: readonly ReadState<unknown>[] = [];
    const read = () => {
      const next = each.map((one) => (one ? one.getSnapshot() : idle));
      if (next.length === last.length && next.every((state, index) => state === last[index])) {
        return last;
      }
      last = next;
      return last;
    };
    return {
      subscribe: (listener) => {
        const stops = each.map((one) => one?.subscribe(listener));
        return () => {
          for (const stop of stops) stop?.();
        };
      },
      getSnapshot: read,
    };
  }

  /**
   * The answer to a read as a promise, from the cache when it holds one. For
   * code that is not a view, such as a map source; it shares the entry's ask
   * with the views, and the ask is cancelled only when none of them is left.
   */
  fetch<M extends keyof Methods>(
    method: M,
    args: Methods[M]['params'],
    options?: { slot?: string }
  ): Promise<Methods[M]['result']>;
  fetch(method: string, args: object, options?: { slot?: string }): Promise<unknown>;
  async fetch(method: string, args: object, options: { slot?: string } = {}): Promise<unknown> {
    // Until the phone lists its methods nothing can be asked, as for a watched read: wait.
    while (this.transport.methods() === null) {
      await new Promise<void>((resolve) => this.listWaiters.add(resolve));
    }
    const entry = this.entry(method, args);
    if (options.slot !== undefined) entry.slot = options.slot;
    if (entry.error?.kind === 'unsupported') throw entry.error;
    if (entry.hasData && !entry.stale && entry.error === null) return entry.data;
    entry.waiters++;
    try {
      this.start(entry);
      const pending = entry.inflight?.promise;
      if (pending === undefined) {
        if (entry.error) throw entry.error;
        throw new ReadError('failed', method, NOT_CONNECTED);
      }
      return await pending;
    } finally {
      entry.waiters--;
      this.release(entry);
    }
  }

  /**
   * Ask the phone and hand back the answer without holding it, for data too
   * large or too short-lived to keep, such as a map tile. It still goes through
   * the one transport, so a withdrawn `slot` and a dropped link behave the same.
   */
  ask(method: string, params: object, slot?: string): Promise<unknown> {
    const listed = this.transport.methods();
    if (listed !== null && !listed.includes(method)) {
      return Promise.reject(new ReadError('unsupported', method));
    }
    return this.transport.ask(method, params, {
      signal: new AbortController().signal,
      ...(slot !== undefined ? { slot } : {}),
    });
  }

  /** Read again what `matcher` names: watched reads keep their data meanwhile. */
  invalidate(matcher: Matcher) {
    const matches =
      typeof matcher === 'function'
        ? matcher
        : (method: string) => (matcher as readonly string[]).includes(method);
    for (const entry of [...this.entries.values()]) {
      if (!matches(entry.method, entry.args)) continue;
      this.stale(entry);
    }
  }

  /** The phone's library changed: everything but an activity's stored series is read again. */
  changed() {
    this.invalidate(UNLESS_STORED);
  }

  /** Forget the series of every activity not in `ids`, as the lists no longer carry it. */
  keepOnly(ids: Iterable<string>) {
    const listed = new Set(ids);
    for (const entry of [...this.entries.values()]) {
      const id = (entry.args as { id?: unknown }).id;
      if (STABLE_METHODS.has(entry.method) && typeof id === 'string' && !listed.has(id)) {
        if (entry.observers === 0 && entry.waiters === 0) this.entries.delete(entry.key);
      }
    }
  }

  /** The phone listed its methods: asks that waited for the list go out. */
  connected() {
    const waiting = [...this.listWaiters];
    this.listWaiters.clear();
    for (const release of waiting) release();
    for (const entry of [...this.entries.values()]) {
      if (entry.observers > 0 || entry.waiters > 0) this.start(entry);
      else this.resolveSupport(entry);
    }
  }

  /** Ask a read again, whatever it holds. */
  retry(method: string, args: object) {
    const entry = this.entries.get(readKey(method, args));
    if (!entry || entry.error?.kind === 'unsupported') return;
    entry.error = null;
    this.stale(entry);
  }

  /**
   * A drop the athlete did not ask for: cancel every ask in flight and keep
   * every answer, which a view still shows as held. Each entry is marked so
   * `connected` asks it again.
   */
  disconnected() {
    for (const entry of [...this.entries.values()]) {
      entry.inflight?.controller.abort();
      entry.inflight = null;
      if (entry.hasData) entry.stale = true;
      this.publish(entry);
    }
  }

  /**
   * Sign out: cancel every ask in flight and forget every answer. A view still
   * watching keeps its entry, empty, and its ask goes out again on `connected`.
   */
  reset() {
    for (const entry of [...this.entries.values()]) {
      entry.inflight?.controller.abort();
      entry.inflight = null;
      entry.data = undefined;
      entry.hasData = false;
      entry.error = null;
      entry.stale = false;
      if (entry.observers === 0 && entry.waiters === 0) this.entries.delete(entry.key);
      this.publish(entry);
    }
  }

  /**
   * Ask the phone a write. With `optimistic`, the reads it names show the
   * change at once and are put back if the phone refuses; with `invalidates`,
   * they are read again once it answers.
   */
  async write<M extends keyof Methods>(
    method: M,
    params: Methods[M]['params'],
    options?: WriteOptions
  ): Promise<WriteOutcome<Methods[M]['result']>>;
  async write(
    method: string,
    params: object,
    options?: WriteOptions
  ): Promise<WriteOutcome<unknown>>;
  async write(
    method: string,
    params: object,
    options: WriteOptions = {}
  ): Promise<WriteOutcome<unknown>> {
    const listed = this.transport.methods();
    if (listed !== null && !listed.includes(method)) {
      const error = new ReadError('unsupported', method);
      this.emit({ method, notice: options.notice, error, undo: null });
      throw error;
    }
    const undone: { entry: Entry; data: unknown; hasData: boolean; shown: unknown }[] = [];
    for (const change of options.optimistic ?? []) {
      const entry = this.entries.get(readKey(change.method, change.args));
      if (!entry?.hasData) continue;
      const shown = (change.update as (held: unknown, params: unknown) => unknown)(
        entry.data,
        params
      );
      undone.push({ entry, data: entry.data, hasData: entry.hasData, shown });
      entry.data = shown;
      this.publish(entry);
    }
    try {
      const result = await this.send(method, params);
      const inverse = options.undo?.(params as never, result as never) ?? null;
      const undo = inverse ? this.reverse(inverse, options.invalidates) : null;
      this.emit({ method, notice: options.notice, error: null, undo });
      if (options.invalidates) this.invalidate(options.invalidates);
      return { result, undo };
    } catch (error) {
      for (const { entry, data, hasData, shown } of undone) {
        if (entry.data === shown) {
          entry.data = data;
          entry.hasData = hasData;
          this.publish(entry);
        }
      }
      this.emit({ method, notice: options.notice, error, undo: null });
      throw classify(method, error);
    }
  }

  /** The undo of an answered write: sends its inverse, then asks what it names again. */
  private reverse(
    inverse: { method: string; params: object; invalidates?: Matcher },
    invalidates: Matcher | undefined
  ): () => Promise<void> {
    return async () => {
      try {
        await this.send(inverse.method, inverse.params);
      } catch (error) {
        this.emit({ method: inverse.method, notice: undefined, error, undo: null });
        throw classify(inverse.method, error);
      }
      this.emit({ method: inverse.method, notice: undefined, error: null, undo: null });
      const matcher = inverse.invalidates ?? invalidates;
      if (matcher) this.invalidate(matcher);
    };
  }

  private emit(event: WriteEvent) {
    for (const listener of [...this.writeListeners]) listener(event);
  }

  private async send(method: string, params: object): Promise<unknown> {
    const controller = new AbortController();
    try {
      return await this.transport.ask(method, params, { signal: controller.signal });
    } catch (error) {
      throw classify(method, error);
    }
  }

  private entry(method: string, args: object): Entry {
    const key = readKey(method, args);
    const held = this.entries.get(key);
    if (held) return held;
    const made: Entry = {
      key,
      method,
      args,
      data: undefined,
      hasData: false,
      error: null,
      stale: false,
      inflight: null,
      observers: 0,
      waiters: 0,
      state: { data: undefined, loading: true, refreshing: false, error: null },
      listeners: new Set(),
    };
    this.entries.set(key, made);
    this.resolveSupport(made);
    this.evict();
    return made;
  }

  /** Fix a method the phone does not list as an error before anything is asked. */
  private resolveSupport(entry: Entry) {
    const listed = this.transport.methods();
    if (listed === null || entry.error?.kind === 'unsupported') return;
    if (!listed.includes(entry.method)) {
      entry.error = new ReadError('unsupported', entry.method);
      this.publish(entry, false);
    }
  }

  /** Ask the entry's read if a view or a fetch wants it and it holds nothing current. */
  private start(entry: Entry) {
    if (this.entries.get(entry.key) !== entry) this.entries.set(entry.key, entry);
    this.resolveSupport(entry);
    if (entry.error?.kind === 'unsupported') return;
    if (this.transport.methods() === null) return;
    if (entry.inflight) return;
    if (entry.hasData && !entry.stale && entry.error === null) return;
    const controller = new AbortController();
    const promise = this.transport
      .ask(entry.method, entry.args, {
        signal: controller.signal,
        ...(entry.slot !== undefined ? { slot: entry.slot } : {}),
      })
      .then(
        (data) => {
          if (entry.inflight?.promise !== mine) return data;
          entry.inflight = null;
          entry.data = data;
          entry.hasData = true;
          entry.error = null;
          entry.stale = false;
          this.publish(entry);
          return data;
        },
        (error) => {
          // An ask withdrawn after the entry moved on is still a withdrawal, not a failure.
          if (entry.inflight?.promise !== mine) {
            throw isQuiet(error) && error instanceof Error ? error : classify(entry.method, error);
          }
          entry.inflight = null;
          if (isQuiet(error)) {
            // Withdrawn, not failed: held data is read again next time it is wanted.
            if (entry.hasData) entry.stale = true;
            this.publish(entry);
            throw error instanceof Error ? error : new CancelledError();
          }
          const failure = classify(entry.method, error);
          entry.error = failure;
          this.publish(entry);
          throw failure;
        }
      );
    const mine = promise;
    entry.inflight = { controller, promise };
    // Observers read the state; an ask nobody awaits must not report an unhandled rejection.
    promise.catch(() => undefined);
    this.publish(entry);
  }

  private stale(entry: Entry) {
    if (entry.inflight) {
      entry.inflight.controller.abort();
      entry.inflight = null;
    }
    entry.stale = true;
    if (entry.observers > 0 || entry.waiters > 0) this.start(entry);
    else this.publish(entry);
  }

  /** A view or fetch let go: an ask nothing waits for is cancelled. */
  private release(entry: Entry) {
    if (entry.observers > 0 || entry.waiters > 0) return;
    if (entry.inflight) {
      entry.inflight.controller.abort();
      entry.inflight = null;
      if (entry.hasData) entry.stale = true;
      else if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
      else return;
    }
    this.evict();
  }

  private evict() {
    const unwatched = [...this.entries.values()].filter(
      (entry) => entry.observers === 0 && entry.waiters === 0 && !STABLE_METHODS.has(entry.method)
    );
    for (const entry of unwatched.slice(0, Math.max(0, unwatched.length - UNWATCHED_LIMIT))) {
      this.entries.delete(entry.key);
    }
  }

  /** Rebuild the snapshot and tell the watchers, but only when it differs. */
  private publish(entry: Entry, notify = true) {
    const inflight = entry.inflight !== null;
    const next: ReadState<unknown> = {
      data: entry.hasData ? entry.data : undefined,
      loading: !entry.hasData && entry.error === null && (inflight || this.waiting(entry)),
      refreshing: entry.hasData && inflight,
      error: entry.error,
    };
    const was = entry.state;
    if (
      was.data === next.data &&
      was.loading === next.loading &&
      was.refreshing === next.refreshing &&
      was.error === next.error
    ) {
      return;
    }
    entry.state = next;
    if (notify) for (const listener of [...entry.listeners]) listener();
  }

  /** Nothing is asked until the phone lists its methods, and the panel shows loading till then. */
  private waiting(entry: Entry) {
    return (
      entry.error === null &&
      (entry.observers > 0 || entry.waiters > 0 || this.transport.methods() === null)
    );
  }
}
