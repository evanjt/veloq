/**
 * Scenario: three surfaces wipe the engine and carry on using it. The identity
 * write after "Clear & Sync" is the one that fails loudest, since the whole
 * branch exists to make it, and a no-op on a closed handle leaves the next
 * launch believing it holds the previous athlete's library.
 *
 * Expected behaviour: a clear leaves an open engine on the same database it
 * just wiped, so a write straight after it lands. The wipe itself runs on a
 * Rust thread, so the re-open waits on its poll rather than racing it.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const mockSettings = { getSetting: jest.fn(), setSetting: jest.fn() };
const mockHeatmap = { setTilesPath: jest.fn(), clearTilesPath: jest.fn() };
const mockNativeEngine = {
  isInitialized: () => true,
  initOutcome: () => 1,
  setObserver: jest.fn(),
  startClearAll: jest.fn(),
  pollClearAll: jest.fn(() => 'complete'),
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
    expect(mockNativeEngine.startClearAll).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenLastCalledWith(DB);
  });

  /** The re-open must follow the wipe, never race the thread running it. */
  it('does not re-open until the wipe reports complete', async () => {
    const client = openClient();
    const states = ['running', 'running', 'complete'];
    mockNativeEngine.pollClearAll.mockImplementation(() => states.shift() as string);
    mockCreate.mockClear();

    await client.clear();

    expect(mockNativeEngine.pollClearAll).toHaveBeenCalledTimes(3);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    mockNativeEngine.pollClearAll.mockImplementation(() => 'complete');
  });

  /** A wipe that fails must still leave a usable engine, not a closed one. */
  it('re-opens even when the wipe itself failed', async () => {
    const client = openClient();
    mockNativeEngine.pollClearAll.mockImplementationOnce(() => {
      throw new Error('A clear is already running');
    });

    await client.clear();

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

  it('clears nothing and opens nothing when no database was ever opened', async () => {
    const client = EngineClient.getInstance();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).initialized = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).dbPath = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).engine = null;
    mockCreate.mockClear();

    await client.clear();

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
