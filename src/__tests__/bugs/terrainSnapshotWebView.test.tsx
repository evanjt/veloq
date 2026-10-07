import React from 'react';
import { View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import {
  TerrainSnapshotWebView,
  MAX_UPGRADE_ATTEMPTS,
  fallbackRequest,
  requestKey,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import { saveTerrainPreview } from '@/features/maps/lib/storage/terrainPreviewCache';
import { subscribeSnapshotFailure } from '@/features/maps/lib/terrainSnapshotEvents';
import type { SnapshotQueueEvent } from '@/features/maps/lib/snapshotQueueTrace';
import {
  clearFFIMetrics,
  getFFIMetricsSummary,
  setAppMetricsEnabled,
} from '@/shared/debug/renderTimer';

const injected: string[] = [];
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;
let mounted = 0;
/** Every WebView ever mounted, so a remount shows even when the live count is unchanged. */
let mountedEver = 0;
/** Each worker's render-process-gone handler, by mount slot. */
const goneHandlers: (() => void)[] = [];
/** Which activity each worker was asked to render, in order, by mount slot. */
const injectedByWorker: string[][] = [[], []];
let mountIndex = 0;

// A getter, because the factory is hoisted above this file's own bindings and
// the component below is one of them.
jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: {
    onMessage: (event: { nativeEvent: { data: string } }) => void;
    onRenderProcessGone?: () => void;
  },
  ref: React.Ref<{ injectJavaScript: (script: string) => void; reload: () => void }>
) {
  onMessage = props.onMessage;
  const slot = React.useRef<number | null>(null);
  if (slot.current === null) {
    slot.current = mountIndex;
    mountIndex += 1;
  }
  const id = slot.current;
  goneHandlers[id] = () => props.onRenderProcessGone?.();
  React.useEffect(() => {
    mounted++;
    mountedEver++;
    return () => {
      mounted--;
    };
  }, []);
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => {
      injected.push(script);
      const named = /var activityId = ["']([^"']+)["']/.exec(script);
      if (named && injectedByWorker[id]) injectedByWorker[id].push(named[1]);
    },
    reload: () => {},
  }));
  return <View />;
});

const mockCached = new Set<string>();
const mockDowngraded = new Set<string>();
// The drape fallback describe keys the cache on the activity alone and reads a
// cached entry as a downgraded one. Every other describe keys it on the
// activity, style and mode, and reads downgrades from their own set.
let mockCacheById = false;
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: (id: string, style: string, is3D: boolean) =>
    mockCacheById ? mockCached.has(id) : mockCached.has(`${id}_${style}_${is3D}`),
  isTerrainPreviewDowngraded: (id: string, style: string, is3D: boolean) =>
    mockCacheById ? mockCached.has(id) : mockDowngraded.has(`${id}_${style}_${is3D}`),
  saveTerrainPreview: jest.fn(async () => 'file:///snap.jpg'),
}));

jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: () => 64,
}));

// Every event the pool records, unbounded, since the trace itself keeps only
// the last few dozen.
const mockEvents: Omit<SnapshotQueueEvent, 'at'>[] = [];
jest.mock('@/features/maps/lib/snapshotQueueTrace', () => {
  const actual = jest.requireActual(
    '@/features/maps/lib/snapshotQueueTrace'
  ) as typeof import('@/features/maps/lib/snapshotQueueTrace');
  return {
    ...actual,
    createSnapshotQueueTrace: () => {
      const trace = actual.createSnapshotQueueTrace();
      return {
        ...trace,
        record: (event: Omit<SnapshotQueueEvent, 'at'>, now: number) => {
          mockEvents.push(event);
          trace.record(event, now);
        },
      };
    },
  };
});

const post = (payload: Record<string, unknown>) =>
  onMessage?.({ nativeEvent: { data: JSON.stringify(payload) } });

const request = (activityId: string, flat = true): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: 0, bearing: 0 },
  mapStyle: 'light',
  routeColor: '#ff0000',
  flat,
});

/** Every request the pool has handed to a worker so far, oldest first. */
const rendered = () =>
  injected
    .map((script) => /var activityId = "([^"]+)"/.exec(script)?.[1])
    .filter((id): id is string => !!id);

const eventsOf = (kind: SnapshotQueueEvent['kind']) => mockEvents.filter((e) => e.kind === kind);

/** What each watchdog firing failed, oldest first. An empty list is a disarmed watchdog. */
const watchdogFired = () => eventsOf('watchdogFired').map((e) => e.detail);

let failures: string[] = [];
let unsubscribes: (() => void)[] = [];

/** Record every failure the pool emits for these cards. */
const watchFailures = (...ids: string[]) => {
  for (const id of ids) unsubscribes.push(subscribeSnapshotFailure(id, () => failures.push(id)));
};

const savedIds = () => (saveTerrainPreview as jest.Mock).mock.calls.map((call) => call[0]);

/** The component's own timeouts and caps. */
const SNAPSHOT_TIMEOUT_MS = 8000;
const MAX_QUEUE_SIZE = 30;
const STALENESS_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS = 2000;
const THROTTLE_BACKOFF_MS = 30000;

beforeEach(() => {
  injected.length = 0;
  mounted = 0;
  mountedEver = 0;
  goneHandlers.length = 0;
  mountIndex = 0;
  injectedByWorker[0] = [];
  injectedByWorker[1] = [];
  mockCached.clear();
  mockDowngraded.clear();
  mockCacheById = false;
  mockEvents.length = 0;
  (saveTerrainPreview as jest.Mock).mockClear();
  failures = [];
  unsubscribes = [];
});

afterEach(() => {
  unsubscribes.forEach((off) => off());
});

/**
 * Scenario: a card re-requests a preview that keeps failing while a worker is
 * busy, so the idle drain never runs and every failure lands in the failed set
 * again, each copy carrying its full coordinate array.
 * Expected behaviour: the set holds one entry per request whatever the failure
 * count, it is capped, and a drain queues each entry once.
 */
describe('the failed set holds one entry per request', () => {
  // The in-flight retry is delayed to let the tile servers recover, so a posted
  // failure only reaches the pool once that timer has run.
  const post = (payload: Record<string, unknown>) => {
    onMessage?.({ nativeEvent: { data: JSON.stringify(payload) } });
    jest.advanceTimersByTime(2000);
  };

  /** Every render the pool has queued, which is what a drain adds to. */
  const queued = () => eventsOf('enqueue').length;

  /**
   * A request already at the last rung of the retry ladder, so one error sends it
   * straight to the failed set with no delayed in-flight retry. That keeps the
   * fake clock still, which matters: the pool's own timeouts would otherwise free
   * the worker this file holds busy and let the idle drain run.
   */
  const exhausted = (activityId: string, flat = true): SnapshotRequest => ({
    ...request(activityId, flat),
    _retryAttempt: 1,
  });

  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  /** Occupy worker 0 and never answer for it, so the queue is never idle. */
  const holdAWorkerBusy = () => pool().requestSnapshot(exhausted('held'));

  /** Fail `activityId` on the free worker without moving the clock. */
  const fail = (activityId: string, flat = true, mapStyle: 'light' | 'satellite' = 'light') => {
    pool().requestSnapshot({ ...exhausted(activityId, flat), mapStyle });
    onMessage?.({
      nativeEvent: {
        data: JSON.stringify({ type: 'snapshotError', workerId: 1, activityId, error: 'tiles' }),
      },
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });
    post({ type: 'mapReady', workerId: 1 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queues one retry after fifty failures of the same request', () => {
    holdAWorkerBusy();
    for (let i = 0; i < 50; i++) fail('a1');
    const before = queued();
    const renders = rendered().length;

    pool().retryFailed();

    expect(queued() - before).toBe(1);
    expect(rendered().length - renders).toBe(1);
  });

  // A drape no longer reaches this set at all: one that runs out of retries
  // falls back to a flat stand-in instead of being filed as a failure, so the
  // set only ever holds flat renders. The keying this case was written to
  // protect is unchanged and is asserted directly below, where it cannot go
  // stale behind a scenario that no longer produces it.
  it('keeps two styles as separate entries', () => {
    holdAWorkerBusy();
    fail('a1', true);
    fail('a1', true, 'satellite');
    const before = queued();

    pool().retryFailed();

    expect(queued() - before).toBe(2);
  });

  it.each([true, false])(
    'keeps a stand-in and a selected flat when the stand-in is first: %s',
    (standInFirst) => {
      const standIn = { ...request('switch'), standIn: true };
      const flat = request('switch');
      const requests = standInFirst ? [standIn, flat] : [flat, standIn];
      requests.forEach((r) => pool().requestSnapshot(r));
      expect(rendered().filter((id) => id === 'switch')).toHaveLength(2);
      pool().requestSnapshot(requests[1]);
      expect(rendered().filter((id) => id === 'switch')).toHaveLength(2);
    }
  );

  it.each([true, false])(
    'keeps both modes queued when the stand-in is first: %s',
    (standInFirst) => {
      pool().requestSnapshot(request('busy-0'));
      pool().requestSnapshot(request('busy-1'));
      const before = queued();
      const standIn = { ...request('switch'), standIn: true };
      const flat = request('switch');
      const requests = standInFirst ? [standIn, flat] : [flat, standIn];
      requests.forEach((r) => pool().requestSnapshot(r));
      pool().requestSnapshot(requests[1]);
      expect(queued() - before).toBe(2);
    }
  );

  it('gives the stand-in, selected flat and drape separate identities', () => {
    const flat = request('switch');
    expect(
      new Set([
        requestKey(flat),
        requestKey({ ...flat, standIn: true }),
        requestKey({ ...flat, flat: false }),
      ]).size
    ).toBe(3);
  });

  it('keys the drape and the flat basemap apart, so neither drops the other', () => {
    const flat = request('a1', true);
    const drape = request('a1', false);

    expect(requestKey(flat)).not.toBe(requestKey(drape));
  });

  it('caps the set rather than growing with every distinct activity', () => {
    holdAWorkerBusy();
    for (let i = 0; i < 60; i++) fail(`a${i}`);
    const before = queued();

    pool().retryFailed();

    expect(queued() - before).toBeLessThanOrEqual(30);
  });

  it('drains to empty, so a second drain queues nothing', () => {
    holdAWorkerBusy();
    fail('a1');
    fail('a2');
    pool().retryFailed();
    const before = queued();

    pool().retryFailed();

    expect(queued()).toBe(before);
  });

  it('queues nothing when nothing has failed', () => {
    holdAWorkerBusy();
    const before = queued();

    pool().retryFailed();

    expect(queued()).toBe(before);
  });
});

/**
 * Scenario: the snapshot pool fails a render, and the athlete never pulls to
 * refresh.
 * Expected behaviour: the failure is retried once the queue goes idle, silently
 * and once. Pull-to-refresh is the only other way back, and a card that never
 * gets one keeps the no-map mark for good.
 */
describe('the snapshot pool retries a failure when the queue goes idle', () => {
  // The in-flight retry is delayed to let the tile servers recover, so a posted
  // failure only reaches the pool once that timer has run.
  const post = (payload: Record<string, unknown>) => {
    onMessage?.({ nativeEvent: { data: JSON.stringify(payload) } });
    jest.advanceTimersByTime(2000);
  };

  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });
    post({ type: 'mapReady', workerId: 1 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-renders a failed request without a pull to refresh', () => {
    pool().requestSnapshot(request('a1'));
    expect(rendered()).toEqual(['a1']);

    // Two failures: the first is the in-flight retry the error path already
    // does, the second exhausts it and lands in the failed set.
    post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: 1 });
    post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: 2 });

    expect(rendered()).toEqual(['a1', 'a1', 'a1']);
  });

  it('retries once and then leaves the card with no map', () => {
    pool().requestSnapshot(request('a1'));
    for (let i = 1; i <= 4; i++) {
      post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: i });
    }

    expect(rendered().length).toBe(3);
  });

  it('does not retry a request whose preview arrived some other way', () => {
    pool().requestSnapshot(request('a1'));
    post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: 1 });
    mockCached.add('a1_light_false');
    post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: 2 });

    expect(rendered()).toEqual(['a1', 'a1']);
  });

  it('still has the request to retry after the idle drain has skipped it', () => {
    pool().requestSnapshot(request('a1'));
    // Three failures: two exhaust the in-flight ladder and land it in the
    // failed map, the third is the idle retry failing in its turn.
    for (let i = 1; i <= 3; i++) {
      post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: i });
    }
    expect(rendered()).toEqual(['a1', 'a1', 'a1']);

    // The drain that skips a key it has already retried must leave the entry
    // where it found it. Dropping it is what made the card unrecoverable.
    pool().retryFailed();

    expect(rendered()).toEqual(['a1', 'a1', 'a1', 'a1']);
  });

  it('lets the idle drain retry again after a pull to refresh', () => {
    pool().requestSnapshot(request('a1'));
    for (let i = 1; i <= 3; i++) {
      post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: i });
    }

    // Pull to refresh is the reset: the one idle retry per key is spent, and
    // this is the athlete asking again.
    pool().retryFailed();
    post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: 4 });
    post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: 5 });

    expect(rendered()).toEqual(['a1', 'a1', 'a1', 'a1', 'a1', 'a1']);
  });

  it('keeps the drape and the flat basemap apart while one is in flight', () => {
    pool().requestSnapshot(request('a1', true));
    pool().requestSnapshot(request('a1', false));

    expect(rendered()).toEqual(['a1', 'a1']);
  });
});

/**
 * Scenario: a worker's render times out or is paused, the pool has nothing else
 * to give it, and the WebView posts its snapshot back a moment later.
 *
 * Expected behaviour: the late snapshot is discarded. The timeout or the pause
 * already dealt with that request, so counting it again puts `completed` past
 * `total`, the watchdog comes off while a card is still owed a render, and a
 * pool that then wedges fails nobody.
 *
 * The generation counter is what tells a stale render from a live one, and it
 * only moves when a new request is assigned. A worker abandoned with nothing
 * to take next keeps the timed-out request's generation, so its late snapshot
 * passes the guard.
 */
describe('a snapshot that arrives after its render was abandoned', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is not counted when a pause put its request back on the queue', () => {
    watchFailures('a0');
    const tree = render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    post({ type: 'mapReady', workerId: 0 });

    tree.rerender(<TerrainSnapshotWebView ref={ref} suspended />);
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });
    act(() => goneHandlers.forEach((gone) => gone()));
    tree.rerender(<TerrainSnapshotWebView ref={ref} />);

    // a0 is back on the queue and still owed a render, so a pool that never
    // comes back fails it rather than forgetting it.
    expect(savedIds()).toEqual([]);
    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);
    expect(watchdogFired()).toEqual(['1 failed']);
    expect(failures).toEqual(['a0']);
  });

  it('is not saved when the timeout already dealt with it', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    post({ type: 'mapReady', workerId: 0 });

    jest.advanceTimersByTime(SNAPSHOT_TIMEOUT_MS + 1);
    pool().requestSnapshot(request('a1'));

    // The timeout counted a0 and released the worker. Its render arriving now
    // must not count against the queue a1 is waiting in.
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    expect(savedIds()).toEqual([]);
  });

  it('still counts the render the worker is actually holding', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });

    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    expect(savedIds()).toEqual(['a0']);
    expect(rendered()).toEqual(['a0', 'a1']);
  });

  it('does not let a paused error count a request that is queued again', () => {
    watchFailures('a0');
    const tree = render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    post({ type: 'mapReady', workerId: 0 });

    tree.rerender(<TerrainSnapshotWebView ref={ref} suspended />);
    post({ type: 'snapshotError', workerId: 0, activityId: 'a0', error: 'boom' });
    act(() => goneHandlers.forEach((gone) => gone()));
    tree.rerender(<TerrainSnapshotWebView ref={ref} />);
    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(watchdogFired()).toEqual(['1 failed']);
    expect(failures).toEqual(['a0']);
  });
});

/**
 * Scenario: the feed keeps mounting cards, so the snapshot queue overflows and
 * drops its oldest request. The total counted that request anyway.
 *
 * Expected behaviour: a request the pool has thrown away is not counted, so
 * completed can still reach the total and the watchdog comes off once the
 * work is done, rather than firing over an empty queue.
 */
describe('the snapshot pool counts only what can still complete', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  /** Queue `count` requests with no worker ready, so nothing is pulled. */
  const queue = (count: number) => {
    for (let i = 0; i < count; i += 1) pool().requestSnapshot(request(`a${i}`));
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds every request while the queue has room for them all', () => {
    queue(MAX_QUEUE_SIZE);

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(watchdogFired()).toEqual([`${MAX_QUEUE_SIZE} failed`]);
  });

  it('holds no more than the cap once the queue overflows', () => {
    queue(MAX_QUEUE_SIZE + 1);

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(watchdogFired()).toEqual([`${MAX_QUEUE_SIZE} failed`]);
  });

  it('traces the card an overflow evicts, so an eviction is not read as a stall', () => {
    queue(MAX_QUEUE_SIZE + 1);

    expect(eventsOf('evict').map((e) => e.activityId)).toEqual(['a0']);
  });

  it('reaches done once everything the queue still holds has completed', () => {
    queue(MAX_QUEUE_SIZE + 1);
    // The oldest was dropped, so the survivors are a1..a30.
    for (let i = 1; i <= MAX_QUEUE_SIZE; i += 1) mockCached.add(`a${i}_light_false`);

    post({ type: 'mapReady', workerId: 0 });
    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(watchdogFired()).toEqual([]);
  });

  it('keeps counting correctly across a second overflow', () => {
    queue(MAX_QUEUE_SIZE + 5);
    for (let i = 5; i < MAX_QUEUE_SIZE + 5; i += 1) mockCached.add(`a${i}_light_false`);

    post({ type: 'mapReady', workerId: 0 });
    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(watchdogFired()).toEqual([]);
  });
});

/**
 * Scenario: the athlete comes back to the feed and a rebuilt worker never
 * posts `mapReady`, which is what happens when Android has reclaimed the
 * WebView process.
 *
 * Expected behaviour: the staleness watchdog fails the queue, so the cards
 * take the no-map mark. The suspend branch clears `mapReadyRef` on every
 * worker and `processNext` skips a worker that is not ready, so the resume
 * call could do nothing by construction; the watchdog was armed only on an
 * enqueue, and the one transition that most needed it never reached it.
 */
describe('a resume where no worker ever becomes ready', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;
  let view: ReturnType<typeof render>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  const setSuspended = (suspended: boolean) =>
    view.rerender(<TerrainSnapshotWebView ref={ref} suspended={suspended} />);

  const workersReady = () => {
    post({ type: 'mapReady', workerId: 0 });
    post({ type: 'mapReady', workerId: 1 });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    view = render(<TerrainSnapshotWebView ref={ref} suspended={false} />);
    workersReady();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fails the queue within the staleness timeout rather than wedging', () => {
    watchFailures('a1');
    pool().requestSnapshot(request('a1'));
    setSuspended(true);
    // Android reclaims the page while the feed is away and it never answers.
    act(() => goneHandlers.forEach((gone) => gone()));
    setSuspended(false);

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(watchdogFired()).toEqual(['1 failed']);
    expect(failures).toEqual(['a1']);
  });

  it('leaves the queue alone while the watchdog is still waiting', () => {
    watchFailures('a1');
    pool().requestSnapshot(request('a1'));
    setSuspended(true);
    act(() => goneHandlers.forEach((gone) => gone()));
    setSuspended(false);

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS - 1);

    expect(watchdogFired()).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('runs the work instead of failing it when a worker does come back', () => {
    pool().requestSnapshot(request('a1'));
    injected.length = 0;
    setSuspended(true);
    act(() => goneHandlers.forEach((gone) => gone()));
    setSuspended(false);

    workersReady();

    expect(rendered()).toEqual(['a1']);
  });

  it('arms nothing on a resume with an empty queue', () => {
    setSuspended(true);
    setSuspended(false);

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(eventsOf('watchdogHeld')).toEqual([]);
    expect(watchdogFired()).toEqual([]);
  });
});

/**
 * Scenario: the athlete leaves the feed part way through a render, so the pool
 * is paused with its queue half done.
 *
 * Expected behaviour: the watchdog stops with the pool, because a pause is
 * neither progress nor failure. The queue itself is untouched, so resuming
 * arms the watchdog over the same work and finishes it.
 */
describe('the snapshot pool watchdog across a suspend', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;
  let view: ReturnType<typeof render>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  const setSuspended = (suspended: boolean) =>
    view.rerender(<TerrainSnapshotWebView ref={ref} suspended={suspended} />);

  const workersReady = () => {
    post({ type: 'mapReady', workerId: 0 });
    post({ type: 'mapReady', workerId: 1 });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    view = render(<TerrainSnapshotWebView ref={ref} suspended={false} />);
    workersReady();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('watches the queue while it is being worked', () => {
    pool().requestSnapshot(request('a1'));
    // A tile error just inside the render timeout, so the retry is still
    // rendering when the watchdog comes due.
    jest.advanceTimersByTime(SNAPSHOT_TIMEOUT_MS - 1000);
    for (const workerId of [0, 1]) {
      post({ type: 'snapshotError', workerId, activityId: 'a1', error: 'tiles' });
    }

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS - SNAPSHOT_TIMEOUT_MS + 1001);

    expect(eventsOf('watchdogHeld').map((e) => e.detail)).toEqual(['a worker is still rendering']);
  });

  it('stops watching when the feed leaves part way through', () => {
    watchFailures('a1', 'a2');
    pool().requestSnapshot(request('a1'));
    pool().requestSnapshot(request('a2'));

    setSuspended(true);
    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS * 4);

    expect(eventsOf('suspend')).toHaveLength(1);
    expect(eventsOf('watchdogHeld')).toEqual([]);
    expect(watchdogFired()).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('watches the same work again when the feed comes back', () => {
    pool().requestSnapshot(request('a1'));
    pool().requestSnapshot(request('a2'));
    setSuspended(true);
    act(() => goneHandlers.forEach((gone) => gone()));

    setSuspended(false);
    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(watchdogFired()).toEqual(['2 failed']);
  });

  it('keeps the queue, so the work still runs after the feed returns', () => {
    pool().requestSnapshot(request('a1'));
    injected.length = 0;

    setSuspended(true);
    setSuspended(false);
    workersReady();

    expect(rendered()).toEqual(['a1']);
  });

  it('says nothing but the suspend when there is no queue at all', () => {
    setSuspended(true);
    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(mockEvents.map((e) => e.kind)).toEqual(['suspend']);
  });
});

/**
 * Scenario: the feed keeps its two snapshot worker WebViews for the whole
 * session, including every minute the athlete spends on another tab. A frozen
 * screen stops React, not the GL context behind it.
 *
 * Expected behaviour: both workers stay mounted while the feed is offscreen,
 * so coming back boots nothing, and only their work pauses. The work in flight
 * when it paused is finished rather than lost.
 */
describe('the snapshot pool follows the feed on and off screen', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;
  let view: ReturnType<typeof render>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  const setSuspended = (suspended: boolean) =>
    view.rerender(<TerrainSnapshotWebView ref={ref} suspended={suspended} />);

  const workersReady = () => {
    post({ type: 'mapReady', workerId: 0 });
    post({ type: 'mapReady', workerId: 1 });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    view = render(<TerrainSnapshotWebView ref={ref} suspended={false} />);
    workersReady();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds two workers while the feed is on screen', () => {
    expect(mounted).toBe(2);
  });

  it('keeps both workers while the feed is offscreen', () => {
    setSuspended(true);

    expect(mounted).toBe(2);
  });

  it('mounts nothing new when the feed returns', () => {
    setSuspended(true);
    setSuspended(false);

    expect(mountedEver).toBe(2);
  });

  it('renders nothing while suspended, and the request waits', () => {
    setSuspended(true);

    pool().requestSnapshot(request('a1'));

    expect(rendered()).toEqual([]);

    setSuspended(false);

    expect(rendered()).toEqual(['a1']);
  });

  it('finishes the render that was in flight when the feed left', () => {
    pool().requestSnapshot(request('a1'));
    expect(rendered()).toEqual(['a1']);

    setSuspended(true);
    setSuspended(false);

    expect(rendered()).toEqual(['a1', 'a1']);
  });

  it('does not fail the queue while it is suspended', () => {
    pool().requestSnapshot(request('a1'));
    setSuspended(true);

    jest.advanceTimersByTime(60_000);
    setSuspended(false);

    expect(rendered()).toEqual(['a1', 'a1']);
  });
});

/**
 * Scenario: an athlete with terrain on, scrolling a feed on a connection that
 * cannot fetch terrain tiles. Every drape request runs out of retries.
 *
 * Expected behaviour: the card gets the flat basemap it could always have
 * drawn, saved as a stand-in so the fact it is not the render that was asked
 * for survives a restart. A flat render that fails has nowhere left to go and
 * is filed as a failure, as it is today.
 */
describe('a drape that runs out falls back to the flat basemap', () => {
  const save = saveTerrainPreview as jest.Mock;

  // A pitched camera, since these are drapes.
  const request = (activityId: string, flat: boolean): SnapshotRequest => ({
    activityId,
    coordinates: [
      [8.7, 47.5],
      [8.72, 47.52],
    ],
    camera: { center: [8.71, 47.51], zoom: 12, pitch: 60, bearing: 0 },
    mapStyle: 'light',
    routeColor: '#ff0000',
    flat,
  });

  /** Already at the last rung, so one error exhausts it with no in-flight retry. */
  const exhausted = (activityId: string, flat: boolean): SnapshotRequest => ({
    ...request(activityId, flat),
    _retryAttempt: 1,
  });

  /** Whether the script handed to a worker draws flat or the drape. */
  const rendersFlat = (script: string) => /var isFlat = true/.test(script);

  beforeEach(() => {
    mockCacheById = true;
  });

  describe('the decision to fall back', () => {
    it('sends an exhausted drape to flat, once', () => {
      const fallback = fallbackRequest(request('a1', false));

      expect(fallback).toMatchObject({ activityId: 'a1', flat: true, standIn: true });
      expect(fallback?._retryAttempt).toBe(0);
    });

    it('keeps the existing stand-in when terrain fails', () => {
      expect(fallbackRequest(request('a1', false), true)).toBeNull();
    });

    it('has nowhere to send an exhausted flat render', () => {
      expect(fallbackRequest(request('a1', true))).toBeNull();
    });

    it('does not send a stand-in back round again', () => {
      const once = fallbackRequest(request('a1', false));

      expect(fallbackRequest(once as SnapshotRequest)).toBeNull();
    });

    it('keeps the camera and the track, so the flat render is of the same ride', () => {
      const original = request('a1', false);

      expect(fallbackRequest(original)).toMatchObject({
        coordinates: original.coordinates,
        camera: original.camera,
        mapStyle: original.mapStyle,
        routeColor: original.routeColor,
      });
    });
  });

  describe('the pool draws the flat basemap when the drape runs out', () => {
    let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

    const pool = () => {
      if (!ref.current) throw new Error('the pool did not mount');
      return ref.current;
    };

    const failOnWorkerOne = (activityId: string, flat: boolean) => {
      pool().requestSnapshot(exhausted(activityId, flat));
      onMessage?.({
        nativeEvent: {
          data: JSON.stringify({ type: 'snapshotError', workerId: 1, activityId, error: 'tiles' }),
        },
      });
    };

    beforeEach(() => {
      jest.useFakeTimers();
      injected.length = 0;
      save.mockClear();
      mockCached.clear();
      ref = React.createRef<TerrainSnapshotWebViewRef>();
      render(<TerrainSnapshotWebView ref={ref} />);
      onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady', workerId: 0 }) } });
      onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady', workerId: 1 }) } });
      // Hold worker 0, so the one under test is worker 1 throughout.
      pool().requestSnapshot(exhausted('held', true));
      injected.length = 0;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('re-renders the same activity flat', () => {
      failOnWorkerOne('a1', false);
      jest.advanceTimersByTime(2000);

      const drawn = injected.filter((s) => s.includes('activityId = "a1"'));
      expect(drawn.length).toBeGreaterThan(0);
      expect(rendersFlat(drawn[drawn.length - 1])).toBe(true);
    });

    it('leaves a failed flat render alone', () => {
      failOnWorkerOne('a2', true);
      jest.advanceTimersByTime(2000);

      // One script, the request itself. A flat render has no rung below it, so
      // nothing draws it a second time.
      expect(injected.filter((s) => s.includes('activityId = "a2"'))).toHaveLength(1);
    });

    const landOnWorkerOne = async (activityId: string) => {
      onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            type: 'snapshot',
            workerId: 1,
            activityId,
            mapStyle: 'light',
            base64: 'bytes',
          }),
        },
      });
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
    };

    it('queues terrain once after a deliberate first paint is saved', async () => {
      const firstPaint = {
        ...request('progressive', true),
        standIn: true,
        firstPaint: true,
      };
      pool().requestSnapshot(firstPaint);
      injected.length = 0;
      mockCached.add('progressive');
      await landOnWorkerOne('progressive');

      const drapes = injected.filter((s) => s.includes('activityId = "progressive"'));
      expect(drapes).toHaveLength(1);
      expect(rendersFlat(drapes[0])).toBe(false);
      expect(save).toHaveBeenCalledWith('progressive', 'light', true, 'bytes', {
        downgradedTo: 'flat',
      });
      injected.length = 0;
      await landOnWorkerOne('progressive');
      expect(injected.filter((s) => s.includes('activityId = "progressive"'))).toHaveLength(0);
    });

    it('keeps a failed drape for recovery without drawing its cached stand-in again', async () => {
      mockCached.add('cached');
      pool().requestSnapshot({ ...exhausted('cached', false), backgroundUpgrade: true });
      injected.length = 0;
      onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            type: 'snapshotError',
            workerId: 1,
            activityId: 'cached',
            error: 'tiles',
          }),
        },
      });
      jest.advanceTimersByTime(2000);
      expect(injected.filter((s) => s.includes('activityId = "cached"'))).toHaveLength(0);

      pool().requestSnapshot(request('recovered', false));
      await landOnWorkerOne('recovered');
      const redrawn = injected.filter((s) => s.includes('activityId = "cached"'));
      expect(redrawn).toHaveLength(1);
      expect(rendersFlat(redrawn[0])).toBe(false);
    });

    it('brings a stood-in card back when another drape renders', async () => {
      failOnWorkerOne('a4', false);
      jest.advanceTimersByTime(2000);
      await landOnWorkerOne('a4');
      injected.length = 0;

      // Another card's drape lands, which is the proof the host is answering.
      pool().requestSnapshot(request('a5', false));
      await landOnWorkerOne('a5');

      const redrawn = injected.filter((s) => s.includes('activityId = "a4"'));
      expect(redrawn).toHaveLength(1);
      expect(rendersFlat(redrawn[0])).toBe(false);
    });

    it('does not bring it back when the render that landed was the stand-in itself', async () => {
      failOnWorkerOne('a6', false);
      jest.advanceTimersByTime(2000);
      injected.length = 0;

      await landOnWorkerOne('a6');

      expect(injected.filter((s) => s.includes('activityId = "a6"'))).toHaveLength(0);
    });

    /** Drapes of `activityId` handed to a worker, from the first script on. */
    const drapesOf = (activityId: string) =>
      injected.filter((s) => s.includes(`activityId = "${activityId}"`) && !rendersFlat(s)).length;

    /** `activityId` runs out on its drape and its flat stand-in lands. */
    const standIn = async (activityId: string) => {
      failOnWorkerOne(activityId, false);
      jest.advanceTimersByTime(2000);
      await landOnWorkerOne(activityId);
      mockCached.add(activityId);
    };

    /** Every drape render an upgrade makes: the render and its one in-flight retry. */
    const RENDERS_PER_ATTEMPT = 2;

    /** Another card's drape lands, then whatever it unlocked fails all the way down. */
    const unlockAndFail = async (drape: string, stoodIn: string) => {
      pool().requestSnapshot(request(drape, false));
      await landOnWorkerOne(drape);
      for (let i = 0; i < RENDERS_PER_ATTEMPT; i++) {
        onMessage?.({
          nativeEvent: {
            data: JSON.stringify({
              type: 'snapshotError',
              workerId: 1,
              activityId: stoodIn,
              error: 'tiles',
            }),
          },
        });
        jest.advanceTimersByTime(2000);
      }
    };

    it('spends no more than the upgrade cap on a card whose drape keeps failing', async () => {
      await standIn('down');
      injected.length = 0;

      for (let i = 0; i < MAX_UPGRADE_ATTEMPTS + 2; i++) await unlockAndFail(`ok${i}`, 'down');

      expect(drapesOf('down')).toBe(MAX_UPGRADE_ATTEMPTS * RENDERS_PER_ATTEMPT);
    });

    it('does not bring back a card that has spent its cap', async () => {
      await standIn('down');
      for (let i = 0; i < MAX_UPGRADE_ATTEMPTS; i++) await unlockAndFail(`ok${i}`, 'down');
      injected.length = 0;

      pool().requestSnapshot(request('late', false));
      await landOnWorkerOne('late');

      expect(drapesOf('down')).toBe(0);
    });

    it('does not queue an unlocked card a second time while its own upgrade waits', async () => {
      await standIn('down');
      pool().requestSnapshot(request('ok', false));
      pool().requestSnapshot(request('other', true));
      pool().requestSnapshot({ ...request('down', false), upgrade: true });
      injected.length = 0;

      await landOnWorkerOne('ok');
      await landOnWorkerOne('other');
      await landOnWorkerOne('down');

      expect(drapesOf('down')).toBe(1);
    });

    it('does not queue an unlocked card a second time while its own upgrade renders', async () => {
      await standIn('down');
      pool().requestSnapshot(request('ok', false));
      pool().requestSnapshot({ ...request('down', false), upgrade: true });
      injected.length = 0;

      await landOnWorkerOne('ok');
      await landOnWorkerOne('down');

      expect(drapesOf('down')).toBe(1);
    });

    it('saves the stand-in under the drape it was asked for', async () => {
      failOnWorkerOne('a3', false);
      jest.advanceTimersByTime(2000);

      onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            type: 'snapshot',
            workerId: 1,
            activityId: 'a3',
            mapStyle: 'light',
            base64: 'bytes',
          }),
        },
      });
      await Promise.resolve();

      expect(save).toHaveBeenCalledWith('a3', 'light', true, 'bytes', { downgradedTo: 'flat' });
    });
  });
});

/**
 * Scenario: the athlete holds one card and changes its map style or its 3D
 * mode. That is a direct instruction about the card they are looking at.
 *
 * Expected behaviour: the new render goes to the head of the queue rather than
 * behind every card the feed has mounted, and a full queue drops an ordinary
 * request instead of the one the athlete just asked for.
 */
describe('an override jumps the snapshot queue', () => {
  const request = (activityId: string, over: Partial<SnapshotRequest> = {}): SnapshotRequest => ({
    activityId,
    coordinates: [
      [8.7, 47.5],
      [8.72, 47.52],
    ],
    camera: { center: [8.71, 47.51], zoom: 12, pitch: 0, bearing: 0 },
    mapStyle: 'light',
    routeColor: '#ff0000',
    flat: true,
    ...over,
  });

  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;
  let view: ReturnType<typeof render>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  const queue = (count: number) => {
    for (let i = 0; i < count; i += 1) pool().requestSnapshot(request(`a${i}`));
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    view = render(<TerrainSnapshotWebView ref={ref} />);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not queue a stand-in already cached under the drape key', () => {
    mockCached.add('chosen_light_true');
    pool().requestSnapshot(request('chosen', { standIn: true }));
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).not.toContain('chosen');
  });

  it('drains a stand-in cached under the drape key while waiting', () => {
    pool().requestSnapshot(request('chosen', { standIn: true }));
    mockCached.add('chosen_light_true');
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).not.toContain('chosen');
    // Drained counts as done, so the pool goes idle and the watchdog with it.
    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);
    expect(watchdogFired()).toEqual([]);
  });

  it('serves first paints before queued background terrain', () => {
    pool().requestSnapshot(request('terrain', { flat: false, backgroundUpgrade: true }));
    pool().requestSnapshot(request('visible'));
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).toContain('activityId = "visible"');
    expect(injected.join('\n')).not.toContain('activityId = "terrain"');
  });

  it('serves an override before a first paint and a background upgrade', () => {
    pool().requestSnapshot(request('terrain', { flat: false, backgroundUpgrade: true }));
    pool().requestSnapshot(request('visible'));
    pool().requestSnapshot(request('chosen', { priority: true }));
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).toContain('activityId = "chosen"');
  });

  it('evicts background terrain before the oldest first paint', () => {
    queue(MAX_QUEUE_SIZE - 1);
    pool().requestSnapshot(request('terrain', { flat: false, backgroundUpgrade: true }));
    pool().requestSnapshot(request('visible'));
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).toContain('activityId = "a0"');
  });

  it('drops an incoming upgrade when the queue is full of first paints', () => {
    queue(MAX_QUEUE_SIZE);
    pool().requestSnapshot(request('terrain', { flat: false, backgroundUpgrade: true }));
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).toContain('activityId = "a0"');
  });

  it('renders the override first, ahead of everything already queued', () => {
    queue(5);
    pool().requestSnapshot(request('chosen', { priority: true }));

    post({ type: 'mapReady', workerId: 0 });

    expect(injected.join('\n')).toContain('chosen');
  });

  it('leaves an ordinary request where it was', () => {
    queue(5);
    pool().requestSnapshot(request('ordinary'));

    post({ type: 'mapReady', workerId: 0 });

    expect(injected.join('\n')).toContain('a0');
    expect(injected.join('\n')).not.toContain('ordinary');
  });

  it('drops an ordinary request when the queue is full, never the override', () => {
    queue(MAX_QUEUE_SIZE);
    pool().requestSnapshot(request('chosen', { priority: true }));

    post({ type: 'mapReady', workerId: 0 });

    expect(injected.join('\n')).toContain('chosen');
  });

  it('still counts the override in the total', () => {
    queue(3);
    pool().requestSnapshot(request('chosen', { priority: true }));
    post({ type: 'mapReady', workerId: 0 });
    for (const id of ['chosen', 'a0', 'a1']) {
      post({ type: 'snapshot', workerId: 0, activityId: id, base64: 'AAAA' });
    }

    // Three of four done and a2 owed a render. A total that missed the
    // override reads three of three, and a pool that never comes back from
    // the pause would then leave a2 waiting for good.
    view.rerender(<TerrainSnapshotWebView ref={ref} suspended />);
    act(() => goneHandlers.forEach((gone) => gone()));
    view.rerender(<TerrainSnapshotWebView ref={ref} />);
    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(watchdogFired()).toEqual(['1 failed']);
  });
});

/**
 * Scenario: the preview pool stops moving on a release build, where every log
 * it carries has been stripped from the bundle.
 * Expected behaviour: the watchdog holding four times in a row is a wedged
 * queue rather than a busy one, and the trace comes out once through the only
 * console call a release build keeps.
 */
describe('a wedged pool reports what it did', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;
  let reported: string[];
  let view: ReturnType<typeof render>;
  let consoleError: jest.SpyInstance;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    reported = [];
    consoleError = jest.spyOn(console, 'error').mockImplementation((line: unknown) => {
      reported.push(String(line));
    });
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    view = render(<TerrainSnapshotWebView ref={ref} />);
  });

  // Restores the one spy this block made, rather than every mock in the file,
  // which would also strip the shared terrain preview cache mock.
  afterEach(() => {
    jest.useRealTimers();
    consoleError.mockRestore();
  });

  /** Two throttles, so the backoff outlasts four watchdog holds. */
  const throttlePool = () => {
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });
    post({
      type: 'snapshotError',
      workerId: 0,
      activityId: 'a0',
      gen: 1,
      error: 'Tile errors: 2',
      tileErrors: 2,
      tileThrottles: 2,
    });
    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + 1000);
    });
    post({
      type: 'snapshotError',
      workerId: 0,
      activityId: 'a0',
      gen: 2,
      error: 'Tile errors: 2',
      tileErrors: 2,
      tileThrottles: 2,
    });
  };

  it('says nothing while the watchdog has only held once or twice', () => {
    throttlePool();

    act(() => {
      jest.advanceTimersByTime(STALENESS_TIMEOUT_MS * 2 + 1000);
    });

    expect(reported).toEqual([]);
  });

  it('names the hold reason, the queue and what led there', () => {
    throttlePool();

    act(() => {
      jest.advanceTimersByTime(STALENESS_TIMEOUT_MS * 4 + 1000);
    });

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('[SnapshotQueue] stalled:');
    expect(reported[0]).toContain('waiting out a tile throttle');
    expect(reported[0]).toContain('enqueue a0');
    expect(reported[0]).toContain('start w0 a0');
  });

  it('reports a run of holds once, not every fifteen seconds after it', () => {
    throttlePool();

    act(() => {
      jest.advanceTimersByTime(STALENESS_TIMEOUT_MS * 12 + 1000);
    });

    expect(reported).toHaveLength(1);
  });

  it('records the feed leaving and returning, and no return at mount', () => {
    act(() => {
      view.rerender(<TerrainSnapshotWebView ref={ref} suspended />);
    });
    act(() => {
      view.rerender(<TerrainSnapshotWebView ref={ref} suspended={false} />);
    });
    throttlePool();

    act(() => {
      jest.advanceTimersByTime(STALENESS_TIMEOUT_MS * 4 + 1000);
    });

    expect(reported).toHaveLength(1);
    const kinds = reported[0]
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(' ')[1]);
    expect(kinds.filter((kind) => kind === 'suspend' || kind === 'resume')).toEqual([
      'suspend',
      'resume',
    ]);
  });
});

/**
 * Scenario: a tile server answers 429. Two of those reject the whole render,
 * and the pipeline's answer was to send the request straight back at the same
 * host, through two workers with a queue up to thirty deep.
 *
 * Expected behaviour: a throttle is an instruction to wait, so it stops the
 * whole pool rather than one request, and the athlete pulling to refresh
 * cannot defeat the wait. An ordinary tile error is not a throttle and leaves
 * the pool running.
 */
describe('a throttled tile server stops the pool', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  /** One worker ready, one request rendering, then the error under test. */
  const failFirst = (over: Record<string, unknown>) => {
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });
    injected.length = 0;
    post({
      type: 'snapshotError',
      workerId: 0,
      activityId: 'a0',
      gen: 1,
      error: 'Tile errors: 2',
      ...over,
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing at all while the backoff runs', () => {
    failFirst({ tileErrors: 2, tileThrottles: 2 });

    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS - 1000);
    });

    expect(injected.join('\n')).not.toContain('a0');
    expect(injected.join('\n')).not.toContain('a1');
  });

  it('picks the queue back up once the backoff has run', () => {
    failFirst({ tileErrors: 2, tileThrottles: 2 });

    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + 1000);
    });

    // The rejected render is the one at the head, so it goes first.
    expect(injected.join('\n')).toContain('a0');
  });

  it('leaves the pool running for a tile error that is not a throttle', () => {
    failFirst({ tileErrors: 2, tileThrottles: 0 });

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(injected.join('\n')).toContain('a0');
  });

  it('does not let a pull-to-refresh defeat the wait', () => {
    failFirst({ tileErrors: 2, tileThrottles: 2 });

    act(() => {
      jest.advanceTimersByTime(5000);
      pool().retryFailed();
      jest.advanceTimersByTime(1000);
    });

    expect(injected.join('\n')).not.toContain('a0');
    expect(injected.join('\n')).not.toContain('a1');
  });

  it('waits longer the second time the server says no', () => {
    failFirst({ tileErrors: 2, tileThrottles: 2 });
    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + 1000);
    });
    post({
      type: 'snapshotError',
      workerId: 0,
      activityId: 'a0',
      gen: 2,
      error: 'Tile errors: 2',
      tileErrors: 2,
      tileThrottles: 2,
    });
    injected.length = 0;

    // The first wait would already be over by here. The second is twice it.
    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + 1000);
    });
    expect(injected).toEqual([]);

    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS);
    });
    expect(injected.length).toBeGreaterThan(0);
  });

  it('goes back to the first wait once a render gets through', () => {
    failFirst({ tileErrors: 2, tileThrottles: 2 });
    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + 1000);
    });
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 2 });
    post({
      type: 'snapshotError',
      workerId: 0,
      activityId: 'a1',
      gen: 3,
      error: 'Tile errors: 2',
      tileErrors: 2,
      tileThrottles: 2,
    });
    injected.length = 0;

    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS - 1000);
    });
    expect(injected).toEqual([]);

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(injected.join('\n')).toContain('a1');
  });

  it('does not let the staleness watchdog fail the queue for waiting', () => {
    // The watchdog gives up after 15 s of no progress, and the backoff is
    // longer than that on purpose. Waiting as instructed is not being stuck.
    failFirst({ tileErrors: 2, tileThrottles: 2 });

    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + 1000);
    });

    expect(injected.join('\n')).toContain('a0');
  });
});

/**
 * Scenario: a preview takes seconds on a real handset and nothing installed
 * can say where they went. The worker page's own log is `__DEV__`-gated, the
 * queue trace is written out only once the watchdog decides the queue is
 * wedged, and the debug APK is embedded with `--dev false`.
 *
 * Expected behaviour: the pool records each stage through `recordAppMetric`,
 * which survives a release build and is what the Developer Dashboard draws. A
 * completed request records one render; an abandoned one records none, or the
 * table's mean would carry renders that never happened.
 */
describe('where a preview spends its seconds', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  /** How many of `name` the ring holds now. Absent reads as none. */
  function calls(name: string): number {
    return getFFIMetricsSummary()[name]?.calls ?? 0;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    // The ring keeps the last 500 readings for the whole file, and every block
    // above records into it. A full ring evicts one reading for each one added,
    // so a count would stop moving. This block starts on an empty ring, as it
    // did in a file of its own.
    clearFFIMetrics();
    setAppMetricsEnabled(true);
    ref = React.createRef<TerrainSnapshotWebViewRef>();
  });

  afterEach(() => jest.useRealTimers());

  it.each(['snapshot', 'snapshotError'])(
    'records per-source tile counts from a %s message',
    (type) => {
      const before = calls('snapshot.tiles.satellite');
      render(<TerrainSnapshotWebView ref={ref} />);
      post({ type: 'mapReady', workerId: 0 });
      pool().requestSnapshot(request('tiles'));
      post({
        type,
        workerId: 0,
        activityId: 'tiles',
        base64: 'AAAA',
        gen: 1,
        tileStats: {
          'satellite-eox': { loaded: 8, total: 10 },
          'satellite-swisstopo-9': { loaded: 5, total: 7 },
          terrain: { loaded: 2, total: 2 },
        },
      });
      expect(calls('snapshot.tiles.satellite')).toBe(before + 1);
      expect(getFFIMetricsSummary()['snapshot.tiles.satellite'].maxMs).toBe(13);
      expect(getFFIMetricsSummary()['snapshot.tiles.terrain'].maxMs).toBe(2);
      expect(getFFIMetricsSummary()['snapshot.tiles.satellite-eox']).toBeUndefined();
      // A duplicate or stale message cannot count a second render.
      post({
        type,
        workerId: 0,
        activityId: 'tiles',
        base64: 'AAAA',
        gen: 1,
        tileStats: { terrain: { loaded: 99 } },
      });
      expect(calls('snapshot.tiles.satellite')).toBe(before + 1);
      expect(getFFIMetricsSummary()['snapshot.tiles.terrain'].maxMs).toBe(2);
    }
  );

  it('records no tile reading when the message carries none', () => {
    const before = calls('snapshot.tiles.terrain');
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });
    pool().requestSnapshot(request('no-counts'));
    post({ type: 'snapshot', workerId: 0, activityId: 'no-counts', base64: 'AAAA', gen: 1 });
    expect(calls('snapshot.tiles.terrain')).toBe(before);
  });

  it('times a worker booting, from its mount to mapReady', () => {
    const before = calls('snapshot.boot');
    render(<TerrainSnapshotWebView ref={ref} />);

    post({ type: 'mapReady', workerId: 0 });

    expect(calls('snapshot.boot')).toBe(before + 1);
  });

  it('times the wait and the render of a request that completes', () => {
    const beforeWait = calls('snapshot.wait');
    const beforeRender = calls('snapshot.render.flat');
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });

    pool().requestSnapshot(request('a0'));
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    expect(calls('snapshot.wait')).toBe(beforeWait + 1);
    expect(calls('snapshot.render.flat')).toBe(beforeRender + 1);
  });

  it('files a drape apart from a flat render', () => {
    const before = calls('snapshot.render.drape');
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });

    pool().requestSnapshot(request('a0', false));
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    expect(calls('snapshot.render.drape')).toBe(before + 1);
  });

  it('times nothing for a render the timeout abandoned', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });
    pool().requestSnapshot(request('a0'));

    jest.advanceTimersByTime(SNAPSHOT_TIMEOUT_MS + 1);
    const after = calls('snapshot.render.flat');
    // The late arrival is discarded by the generation guard, so it must not
    // land a reading either: a render that was never captured has no duration.
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    expect(calls('snapshot.render.flat')).toBe(after);
  });

  it('records the page elapsed under the path it took', () => {
    const before = calls('snapshot.page.fast');
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });

    pool().requestSnapshot(request('a0'));
    post({
      type: 'snapshot',
      workerId: 0,
      activityId: 'a0',
      base64: 'AAAA',
      gen: 1,
      fastPath: true,
      elapsed: 120,
    });

    expect(calls('snapshot.page.fast')).toBe(before + 1);
  });

  it('records the stages the page stamped inside that elapsed', () => {
    const before = ['style', 'settle', 'probe', 'encode'].map((p) => calls(`snapshot.phase.${p}`));
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });

    pool().requestSnapshot(request('a0'));
    post({
      type: 'snapshot',
      workerId: 0,
      activityId: 'a0',
      base64: 'AAAA',
      gen: 1,
      elapsed: 3_540,
      phases: { style: 40, settle: 3_200, probe: 180, encode: 120 },
    });

    expect(['style', 'settle', 'probe', 'encode'].map((p) => calls(`snapshot.phase.${p}`))).toEqual(
      before.map((n) => n + 1)
    );
  });

  it('records no stage for a render the timeout abandoned', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });
    pool().requestSnapshot(request('a0'));

    jest.advanceTimersByTime(SNAPSHOT_TIMEOUT_MS + 1);
    const after = calls('snapshot.phase.settle');
    post({
      type: 'snapshot',
      workerId: 0,
      activityId: 'a0',
      base64: 'AAAA',
      gen: 1,
      phases: { style: 40, settle: 3_200 },
    });

    expect(calls('snapshot.phase.settle')).toBe(after);
  });
});

/**
 * Scenario: in `smart` 3D mode the feed mixes flat and drape cards by whether
 * the ride has terrain worth draping. The pool handed each request to
 * whichever worker was free first, so a feed of ride, run, ride, run gave each
 * worker flat, drape, flat, drape and every render rebuilt the whole style
 * rather than jumping the camera over the one already mounted.
 *
 * Expected behaviour: the pool sends a render to a free worker that already
 * holds its style and mode, and sends it to any free worker when none does.
 */
describe('which worker a render goes to', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  /** Which worker was handed `activityId`, or -1. */
  function tookIt(activityId: string): number {
    return injectedByWorker.findIndex((list) => list.includes(activityId));
  }

  /** Give worker 0 a flat render and worker 1 a drape, then free both. */
  function settleWorkers() {
    pool().requestSnapshot(request('flat-seed', true));
    post({ type: 'mapReady', workerId: 0 });
    pool().requestSnapshot(request('drape-seed', false));
    post({ type: 'mapReady', workerId: 1 });
    post({ type: 'snapshot', workerId: 0, activityId: 'flat-seed', base64: 'AAAA', gen: 1 });
    post({ type: 'snapshot', workerId: 1, activityId: 'drape-seed', base64: 'AAAA', gen: 1 });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mountIndex = 0;
    injectedByWorker[0] = [];
    injectedByWorker[1] = [];
    ref = React.createRef<TerrainSnapshotWebViewRef>();
  });

  afterEach(() => jest.useRealTimers());

  it('sends a flat render to the worker that last drew flat', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    settleWorkers();
    expect(tookIt('flat-seed')).toBe(0);
    expect(tookIt('drape-seed')).toBe(1);

    pool().requestSnapshot(request('a-flat', true));

    expect(tookIt('a-flat')).toBe(0);
  });

  it('sends a drape to the worker that last drew a drape', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    settleWorkers();

    pool().requestSnapshot(request('a-drape', false));

    expect(tookIt('a-drape')).toBe(1);
  });

  it('sends it out anyway when the matching worker is busy', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    settleWorkers();

    // Worker 0 takes a flat render and is now busy.
    pool().requestSnapshot(request('holds-0', true));
    expect(tookIt('holds-0')).toBe(0);

    // A second flat render has no matching worker free. It must not wait.
    pool().requestSnapshot(request('a-flat-2', true));

    expect(tookIt('a-flat-2')).toBe(1);
  });
});

/**
 * Scenario: the preview pool holds a failed render back to let the tile host
 * recover, while the feed keeps mounting cards and the screen can go away
 * underneath it.
 * Expected behaviour: the wait is a property of the request, so nothing that
 * runs the pool early can start it; a failed stand-in is judged against the
 * drape slot it is saved under; and once the pool is gone none of its timers
 * can fail a card.
 */
describe('the pool timers', () => {
  const request = (activityId: string, over: Partial<SnapshotRequest> = {}): SnapshotRequest => ({
    activityId,
    coordinates: [
      [8.7, 47.5],
      [8.72, 47.52],
    ],
    camera: { center: [8.71, 47.51], zoom: 12, pitch: 0, bearing: 0 },
    mapStyle: 'light',
    routeColor: '#ff0000',
    flat: true,
    ...over,
  });

  const rendersOf = (activityId: string) => rendered().filter((id) => id === activityId).length;

  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;
  let view: ReturnType<typeof render>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    view = render(<TerrainSnapshotWebView ref={ref} />);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('a retried render waits out its delay', () => {
    /** a0 fails on worker 0 with an ordinary tile error, worker 1 idle. */
    const failOnce = () => {
      post({ type: 'mapReady', workerId: 0 });
      pool().requestSnapshot(request('a0'));
      post({ type: 'mapReady', workerId: 1 });
      post({ type: 'snapshotError', workerId: 0, activityId: 'a0', gen: 1, error: 'tiles' });
    };

    it('is not started by a card mounting during the delay', () => {
      failOnce();
      jest.advanceTimersByTime(RETRY_DELAY_MS / 2);

      pool().requestSnapshot(request('a1'));

      expect(rendered()).toEqual(['a0', 'a1']);
    });

    it('is not started by another render finishing during the delay', () => {
      post({ type: 'mapReady', workerId: 0 });
      post({ type: 'mapReady', workerId: 1 });
      pool().requestSnapshot(request('a0'));
      pool().requestSnapshot(request('a1'));
      const a0Worker = 0;
      post({ type: 'snapshotError', workerId: a0Worker, activityId: 'a0', gen: 1, error: 'tiles' });
      jest.advanceTimersByTime(RETRY_DELAY_MS / 2);

      post({ type: 'snapshot', workerId: 1, activityId: 'a1', base64: 'AAAA', gen: 1 });

      expect(rendersOf('a0')).toBe(1);
    });

    it('starts on its own once the delay has run', () => {
      failOnce();
      pool().requestSnapshot(request('a1'));

      jest.advanceTimersByTime(RETRY_DELAY_MS - 1);
      expect(rendersOf('a0')).toBe(1);

      jest.advanceTimersByTime(1);
      expect(rendersOf('a0')).toBe(2);
    });

    it('holds the flat fallback of an exhausted drape the same way', () => {
      post({ type: 'mapReady', workerId: 0 });
      pool().requestSnapshot(request('d0', { flat: false, _retryAttempt: 1 }));
      post({ type: 'mapReady', workerId: 1 });
      post({ type: 'snapshotError', workerId: 0, activityId: 'd0', gen: 1, error: 'tiles' });

      pool().requestSnapshot(request('a1'));
      expect(rendersOf('d0')).toBe(1);

      jest.advanceTimersByTime(RETRY_DELAY_MS);
      expect(rendersOf('d0')).toBe(2);
      expect(injected[injected.length - 1]).toMatch(/var isFlat = true/);
    });

    it('starts two retries in the order their delays run out', () => {
      post({ type: 'mapReady', workerId: 0 });
      post({ type: 'mapReady', workerId: 1 });
      pool().requestSnapshot(request('a0'));
      pool().requestSnapshot(request('a1'));
      post({ type: 'snapshotError', workerId: 0, activityId: 'a0', gen: 1, error: 'tiles' });
      jest.advanceTimersByTime(RETRY_DELAY_MS / 2);
      post({ type: 'snapshotError', workerId: 1, activityId: 'a1', gen: 1, error: 'tiles' });

      jest.advanceTimersByTime(RETRY_DELAY_MS / 2);
      expect(rendered()).toEqual(['a0', 'a1', 'a0']);

      jest.advanceTimersByTime(RETRY_DELAY_MS / 2);
      expect(rendered()).toEqual(['a0', 'a1', 'a0', 'a1']);
    });
  });

  describe('a failed stand-in is judged against the drape slot', () => {
    const standIn = () => request('s0', { standIn: true, _retryAttempt: 1 });

    it('is retried by the idle drain although a plain flat is cached', () => {
      mockCached.add('s0_light_false');
      post({ type: 'mapReady', workerId: 0 });
      pool().requestSnapshot(standIn());

      post({ type: 'snapshotError', workerId: 0, activityId: 's0', gen: 1, error: 'tiles' });

      expect(rendersOf('s0')).toBe(2);
    });

    it('is retried by a pull to refresh although a plain flat is cached', () => {
      mockCached.add('s0_light_false');
      post({ type: 'mapReady', workerId: 0 });
      post({ type: 'mapReady', workerId: 1 });
      // Worker 0 stays busy, so the idle drain never runs and only the pull can.
      pool().requestSnapshot(request('held', { _retryAttempt: 1 }));
      pool().requestSnapshot(standIn());
      post({ type: 'snapshotError', workerId: 1, activityId: 's0', gen: 1, error: 'tiles' });
      expect(rendersOf('s0')).toBe(1);

      pool().retryFailed();

      expect(rendersOf('s0')).toBe(2);
    });

    it('is left alone by a pull to refresh once its stand-in is saved', () => {
      post({ type: 'mapReady', workerId: 0 });
      post({ type: 'mapReady', workerId: 1 });
      pool().requestSnapshot(request('held', { _retryAttempt: 1 }));
      pool().requestSnapshot(standIn());
      post({ type: 'snapshotError', workerId: 1, activityId: 's0', gen: 1, error: 'tiles' });
      mockCached.add('s0_light_true');
      mockDowngraded.add('s0_light_true');

      pool().retryFailed();

      expect(rendersOf('s0')).toBe(1);
    });
  });

  describe('an unmounted pool fails no card', () => {
    it('lets no throttle timer render or fail anything after unmount', () => {
      watchFailures('a0', 'a1');
      post({ type: 'mapReady', workerId: 0 });
      pool().requestSnapshot(request('a0'));
      pool().requestSnapshot(request('a1'));
      post({
        type: 'snapshotError',
        workerId: 0,
        activityId: 'a0',
        gen: 1,
        error: 'Tile errors: 2',
        tileErrors: 2,
        tileThrottles: 2,
      });
      const before = rendered().length;

      view.unmount();
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + SNAPSHOT_TIMEOUT_MS + STALENESS_TIMEOUT_MS);

      expect(rendered().length).toBe(before);
      expect(failures).toEqual([]);
    });

    it('lets no retry timer render or fail anything after unmount', () => {
      watchFailures('a0');
      post({ type: 'mapReady', workerId: 0 });
      pool().requestSnapshot(request('a0'));
      post({ type: 'snapshotError', workerId: 0, activityId: 'a0', gen: 1, error: 'tiles' });

      view.unmount();
      jest.advanceTimersByTime(RETRY_DELAY_MS + SNAPSHOT_TIMEOUT_MS + STALENESS_TIMEOUT_MS);

      expect(rendersOf('a0')).toBe(1);
      expect(failures).toEqual([]);
    });

    it('lets no queued request fail after unmount', () => {
      watchFailures('a0');
      pool().requestSnapshot(request('a0'));

      view.unmount();
      jest.advanceTimersByTime(STALENESS_TIMEOUT_MS * 2);

      expect(failures).toEqual([]);
    });
  });
});
