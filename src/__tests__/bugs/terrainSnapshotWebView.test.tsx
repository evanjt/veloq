import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  TerrainSnapshotWebView,
  requestKey,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const injected: string[] = [];
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;
let mounted = 0;

// A getter, because the factory is hoisted above this file's own bindings and
// the component below is one of them.
jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: { onMessage: (event: { nativeEvent: { data: string } }) => void },
  ref: React.Ref<{ injectJavaScript: (script: string) => void; reload: () => void }>
) {
  onMessage = props.onMessage;
  React.useEffect(() => {
    mounted++;
    return () => {
      mounted--;
    };
  }, []);
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => injected.push(script),
    reload: () => {},
  }));
  return <View />;
});

const mockCached = new Set<string>();
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: (id: string, style: string, is3D: boolean) =>
    mockCached.has(`${id}_${style}_${is3D}`),
  saveTerrainPreview: jest.fn(async () => 'file:///snap.jpg'),
}));

jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: () => 64,
}));

const mockProgress = jest.fn();
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: {
    getState: () => ({
      setTerrainSnapshotProgress: (progress: unknown) => mockProgress(progress),
    }),
  },
}));

type Progress = { status: string; completed: number; total: number };

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

const lastProgress = (): Progress =>
  mockProgress.mock.calls[mockProgress.mock.calls.length - 1]?.[0] as Progress;

/** The component's own timeouts and caps. */
const SNAPSHOT_TIMEOUT_MS = 8000;
const MAX_QUEUE_SIZE = 30;
const STALENESS_TIMEOUT_MS = 15000;

beforeEach(() => {
  injected.length = 0;
  mounted = 0;
  mockCached.clear();
  mockProgress.mockClear();
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

  /** Every render the pool has asked for, which is what a drain adds to. */
  const queued = () => lastProgress()?.total ?? 0;

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
 * Scenario: a worker's render times out, the pool has nothing else to give it,
 * and the WebView posts its snapshot back a moment later.
 *
 * Expected behaviour: the late snapshot is discarded. The timeout already
 * counted that request as completed, so counting it again puts `completed`
 * past `total` and the progress reports done while other cards are still
 * queued.
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
    const tree = render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });

    tree.rerender(<TerrainSnapshotWebView ref={ref} suspended />);
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });
    tree.rerender(<TerrainSnapshotWebView ref={ref} />);

    // a0 is back on the queue and still owed a render, so nothing is done yet.
    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 2 });
  });

  it('is not counted twice when the timeout already counted it', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    post({ type: 'mapReady', workerId: 0 });

    jest.advanceTimersByTime(SNAPSHOT_TIMEOUT_MS + 1);
    pool().requestSnapshot(request('a1'));
    mockProgress.mockClear();

    // The timeout counted a0 and released the worker. Its render arriving now
    // must not count a second time against the queue a1 is waiting in.
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    for (const call of mockProgress.mock.calls) {
      const p = call[0] as Progress;
      expect(p.completed).toBeLessThanOrEqual(p.total);
    }
  });

  it('still counts the render the worker is actually holding', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });

    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 1, total: 2 });
  });

  it('does not let a paused error count a request that is queued again', () => {
    const tree = render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });

    tree.rerender(<TerrainSnapshotWebView ref={ref} suspended />);
    post({ type: 'snapshotError', workerId: 0, activityId: 'a0', error: 'boom' });
    tree.rerender(<TerrainSnapshotWebView ref={ref} />);

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 2 });
  });
});

/**
 * Scenario: the feed keeps mounting cards, so the snapshot queue overflows and
 * drops its oldest request. The total counted that request anyway.
 *
 * Expected behaviour: a request the pool has thrown away is not counted, so
 * completed can still reach the total and the progress notification reaches
 * done instead of sitting on screen for the whole session.
 */
describe('the snapshot progress counts only what can still complete', () => {
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

  it('counts every request while the queue still holds them all', () => {
    queue(MAX_QUEUE_SIZE);

    expect(lastProgress().total).toBe(MAX_QUEUE_SIZE);
  });

  it('does not count the request the full queue threw away', () => {
    queue(MAX_QUEUE_SIZE + 1);

    expect(lastProgress().total).toBe(MAX_QUEUE_SIZE);
  });

  it('reaches done once everything the queue still holds has completed', () => {
    queue(MAX_QUEUE_SIZE + 1);
    // The oldest was dropped, so the survivors are a1..a30.
    for (let i = 1; i <= MAX_QUEUE_SIZE; i += 1) mockCached.add(`a${i}_light_false`);

    post({ type: 'mapReady', workerId: 0 });

    expect(lastProgress()).toEqual({ status: 'idle', completed: 0, total: 0 });
  });

  it('keeps counting correctly across a second overflow', () => {
    queue(MAX_QUEUE_SIZE + 5);

    expect(lastProgress().total).toBe(MAX_QUEUE_SIZE);
  });
});

/**
 * Scenario: the athlete comes back to the feed and a rebuilt worker never
 * posts `mapReady`, which is what happens when Android has reclaimed the
 * WebView process.
 *
 * Expected behaviour: the staleness watchdog fails the queue and the pipeline
 * returns to idle. The suspend branch clears `mapReadyRef` on every worker and
 * `processNext` skips a worker that is not ready, so the resume call could do
 * nothing by construction; the watchdog was armed only from `updateProgress`,
 * and the one transition that most needed it never reached it.
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
    pool().requestSnapshot(request('a1'));
    setSuspended(true);
    setSuspended(false);
    // No `mapReady` after the rebuild: the reclaimed process never answers.

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 1 });

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(lastProgress()).toEqual({ status: 'idle', completed: 0, total: 0 });
  });

  it('leaves the queue alone while the watchdog is still waiting', () => {
    pool().requestSnapshot(request('a1'));
    setSuspended(true);
    setSuspended(false);

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS - 1);

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 1 });
  });

  it('runs the work instead of failing it when a worker does come back', () => {
    pool().requestSnapshot(request('a1'));
    injected.length = 0;
    setSuspended(true);
    setSuspended(false);

    workersReady();

    expect(rendered()).toEqual(['a1']);
  });

  it('arms nothing on a resume with an empty queue', () => {
    setSuspended(true);
    setSuspended(false);
    mockProgress.mockClear();

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(mockProgress).not.toHaveBeenCalled();
  });
});

/**
 * Scenario: the athlete leaves the feed part way through a render, so the pool
 * is torn down with its queue half done.
 *
 * Expected behaviour: the reported progress goes idle, because a pause is
 * neither progress nor failure and nothing that could clear it can run while
 * suspended. The queue itself is untouched, so resuming reports the same count
 * it had and finishes the work.
 */
describe('the progress the snapshot pool reports across a suspend', () => {
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

  it('reports rendering while the queue is being worked', () => {
    pool().requestSnapshot(request('a1'));
    pool().requestSnapshot(request('a2'));

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 2 });
  });

  it('goes idle when the feed leaves part way through', () => {
    pool().requestSnapshot(request('a1'));
    pool().requestSnapshot(request('a2'));

    setSuspended(true);

    expect(lastProgress()).toEqual({ status: 'idle', completed: 0, total: 0 });
  });

  it('reports the same count again when the feed comes back', () => {
    pool().requestSnapshot(request('a1'));
    pool().requestSnapshot(request('a2'));
    setSuspended(true);

    setSuspended(false);

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 2 });
  });

  it('keeps the queue, so the work still runs after the feed returns', () => {
    pool().requestSnapshot(request('a1'));
    injected.length = 0;

    setSuspended(true);
    setSuspended(false);
    workersReady();

    expect(rendered()).toEqual(['a1']);
  });

  it('says nothing new on a suspend with no queue at all', () => {
    mockProgress.mockClear();

    setSuspended(true);

    expect(lastProgress()).toEqual({ status: 'idle', completed: 0, total: 0 });
  });
});

/**
 * Scenario: the feed keeps its two snapshot worker WebViews for the whole
 * session, including every minute the athlete spends on another tab. A frozen
 * screen stops React, not the GL context behind it.
 *
 * Expected behaviour: both workers come down while the feed is offscreen and
 * come back with it, and the work in flight when they went is finished rather
 * than lost.
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

  it('holds none while the feed is offscreen', () => {
    setSuspended(true);

    expect(mounted).toBe(0);
  });

  it('builds both back when the feed returns', () => {
    setSuspended(true);
    setSuspended(false);

    expect(mounted).toBe(2);
  });

  it('renders nothing while suspended, and the request waits', () => {
    setSuspended(true);

    pool().requestSnapshot(request('a1'));

    expect(rendered()).toEqual([]);

    setSuspended(false);
    workersReady();

    expect(rendered()).toEqual(['a1']);
  });

  it('finishes the render that was in flight when the feed left', () => {
    pool().requestSnapshot(request('a1'));
    expect(rendered()).toEqual(['a1']);

    setSuspended(true);
    setSuspended(false);
    workersReady();

    expect(rendered()).toEqual(['a1', 'a1']);
  });

  it('does not fail the queue while it is suspended', () => {
    pool().requestSnapshot(request('a1'));
    setSuspended(true);

    jest.advanceTimersByTime(60_000);
    setSuspended(false);
    workersReady();

    expect(rendered()).toEqual(['a1', 'a1']);
  });
});
