/**
 * Scenario: three surfaces wipe the engine and carry on using it. The identity
 * write after "Clear & Sync" is the one that fails loudest, since the whole
 * branch exists to make it, and a no-op on a closed handle leaves the next
 * launch believing it holds the previous athlete's library.
 *
 * Expected behaviour: a clear leaves an open engine on the same database it
 * just wiped, so a write straight after it lands. The wipe is an async export,
 * so the re-open waits on its promise rather than racing it, and no wall-clock
 * ceiling of its own can cut the wait short.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const mockSettings = { getSetting: jest.fn(), setSetting: jest.fn() };
const mockHeatmap = { setTilesPath: jest.fn(), clearTilesPath: jest.fn() };
const mockNativeEngine = {
  isInitialized: () => true,
  initOutcome: () => 1,
  setObserver: jest.fn(),
  runClearAll: jest.fn(() => Promise.resolve()),
  destroy: jest.fn(),
  settings: () => mockSettings,
  heatmap: () => mockHeatmap,
};
const mockCreate = jest.fn((_dbPath: string) => mockNativeEngine);

// The default export carries the binding's own initialise, which installs the
// EngineObserver vtable. The client withholds the observer without it.
jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  __esModule: true,
  default: { initialize: jest.fn() },
  FfiInitOutcome: { Opened: 1, NotAttempted: 5, Failed: 6 },
  VeloqEngine: {
    create: (path: string) => mockCreate(path),
  },
}));

const DB = '/data/routes.db';

function openClient() {
  const client = EngineClient.getInstance();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).initialized = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).dbPath = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).engine = null;
  // A notification queued under fake timers never flushes and would hold the scheduler shut.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).notifyScheduled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).pendingNotifications.clear();
  expect(client.initWithPath(DB)).toBe(true);
  return client;
}

describe('EngineClient.clear', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const store = new Map<string, string>();
    mockSettings.getSetting.mockImplementation((key: string) => store.get(key) ?? null);
    mockSettings.setSetting.mockImplementation((key: string, value: string) => {
      store.set(key, value);
    });
  });

  it('leaves the engine open on the database it just wiped', async () => {
    const client = openClient();

    await client.clear();

    expect(client.isInitialized()).toBe(true);
    expect(mockNativeEngine.runClearAll).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenLastCalledWith(DB);
  });

  /** The re-open must follow the wipe, never race the thread running it. */
  it('does not re-open until the wipe promise settles', async () => {
    const client = openClient();
    let finish: () => void = () => {};
    mockNativeEngine.runClearAll.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    mockCreate.mockClear();

    const cleared = client.clear();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockNativeEngine.destroy).not.toHaveBeenCalled();

    finish();
    await cleared;
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario: the app is suspended mid-wipe and comes back more than two
   * minutes later, with the wipe finishing just after. A wall-clock ceiling
   * reads that gap as a stuck wipe and fails Clear & Sync for a wipe that
   * succeeded.
   *
   * Expected behaviour: clear resolves, having waited for the wipe itself.
   */
  it('resolves for a wipe that finishes after the clock has moved past two minutes', async () => {
    jest.useFakeTimers();
    try {
      const client = openClient();
      let finish: () => void = () => {};
      mockNativeEngine.runClearAll.mockImplementationOnce(
        () => new Promise<void>((resolve) => (finish = resolve))
      );
      const cleared = client.clear();
      jest.advanceTimersByTime(3 * 60 * 1000);
      finish();
      await expect(cleared).resolves.toBeUndefined();
      expect(client.isInitialized()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  /** A wipe that fails must still leave a usable engine, not a closed one. */
  // The re-open still happens, and the failure still reaches the caller: a
  // wipe that fails quietly is what let the login screen tell an athlete their
  // library was gone while it sat on disk.
  it('re-opens even when the wipe itself failed, and says the wipe failed', async () => {
    const client = openClient();
    // Rust refuses a second clear with its own variant, and the caller branches
    // on the tag rather than on the English message.
    const busy = Object.assign(new Error('A clear is already running'), {
      tag: 'Busy',
      inner: { msg: 'A clear is already running' },
    });
    mockNativeEngine.runClearAll.mockImplementationOnce(() => Promise.reject(busy));

    await expect(client.clear()).rejects.toMatchObject({ tag: 'Busy' });

    expect(client.isInitialized()).toBe(true);
    expect(mockCreate).toHaveBeenLastCalledWith(DB);
  });

  it('lands the identity write that follows a clear', async () => {
    const client = openClient();

    await client.clear();
    client.setSetting('__athlete_id', 'a-99');

    expect(client.getSetting('__athlete_id')).toBe('a-99');
  });

  /**
   * Scenario: the tiles path lives only in the engine's memory, and a clear
   * destroys the engine and opens a new one. `enableHeatmapTiles` is called
   * from the layout's post-init block, which does not run again for a clear
   * mid-session, so afterwards the path was unset: `mark_heatmap_dirty`
   * returned early, generation did nothing, and the next launch reported the
   * previous library's tiles up to date and served them.
   *
   * Expected behaviour: the re-open re-applies whatever the athlete last chose,
   * so the engine that comes back is the one that went away.
   */
  it('re-applies the heatmap tiles path the athlete had enabled', async () => {
    const client = openClient();
    client.enableHeatmapTiles();
    const path = mockHeatmap.setTilesPath.mock.calls[0][0];
    mockHeatmap.setTilesPath.mockClear();

    await client.clear();

    expect(mockHeatmap.setTilesPath).toHaveBeenCalledWith(path);
  });

  /** And leaves it off for an athlete who turned it off. */
  it('does not turn the heatmap back on for an athlete who turned it off', async () => {
    const client = openClient();
    client.enableHeatmapTiles();
    client.disableHeatmapTiles();
    mockHeatmap.setTilesPath.mockClear();

    await client.clear();

    expect(mockHeatmap.setTilesPath).not.toHaveBeenCalled();
  });

  it('re-registers the observer, so the reopened engine still announces', async () => {
    const client = openClient();
    mockNativeEngine.setObserver.mockClear();

    await client.clear();

    expect(mockNativeEngine.setObserver).toHaveBeenCalledTimes(1);
  });

  it('reports a clear it could not reopen rather than claiming an engine', async () => {
    const client = openClient();
    mockCreate.mockImplementationOnce(() => {
      throw new Error('database is locked');
    });

    await client.clear();

    expect(client.isInitialized()).toBe(false);
    expect(client.getSetting('__athlete_id')).toBeUndefined();
  });

  // Was: resolves quietly having done nothing. That is the shape the login
  // screen hit, where the handle is closed by design and the athlete had just
  // accepted "Continue and delete".
  it('refuses rather than reporting a wipe when there is no database to open', async () => {
    const client = EngineClient.getInstance();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).initialized = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).dbPath = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).engine = null;
    mockCreate.mockClear();

    await expect(client.clear()).rejects.toThrow();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(client.isInitialized()).toBe(false);
  });

  it('destroyEngine still leaves the engine closed, since a restore replaces the file', () => {
    const client = openClient();
    mockCreate.mockClear();

    client.destroyEngine();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(client.isInitialized()).toBe(false);
  });
});

describe('EngineClient.runClearDerived', () => {
  const removed = { sectionsRemoved: 4, activitiesRemoved: 90, activitiesKept: 3 };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.getSetting.mockReturnValue(null);
  });

  afterEach(() => {
    delete (mockNativeEngine as Record<string, unknown>).runClearDerived;
  });

  it('announces activities, groups and sections once the clear resolves', async () => {
    const client = openClient();
    let finish: (counts: typeof removed) => void = () => {};
    (mockNativeEngine as Record<string, unknown>).runClearDerived = jest.fn(
      () => new Promise<typeof removed>((resolve) => (finish = resolve))
    );
    const heard: string[] = [];
    const unsubscribe = ['activities', 'groups', 'sections'].map((event) =>
      client.subscribe(event, () => heard.push(event))
    );

    const clearing = client.runClearDerived();
    expect(heard).toEqual([]);
    finish(removed);
    await expect(clearing).resolves.toEqual(removed);
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe.forEach((off) => off());

    expect([...heard].sort()).toEqual(['activities', 'groups', 'sections']);
  });

  it('announces nothing when the clear fails', async () => {
    const client = openClient();
    (mockNativeEngine as Record<string, unknown>).runClearDerived = jest.fn(() =>
      Promise.reject(new Error('disk full'))
    );
    const heard = jest.fn();
    const off = client.subscribe('activities', heard);

    await expect(client.runClearDerived()).rejects.toThrow('disk full');
    await new Promise((resolve) => setTimeout(resolve, 0));
    off();

    expect(heard).not.toHaveBeenCalled();
  });
});
