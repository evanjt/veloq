/**
 * Scenario: the login screen runs with the engine closed by design, and both
 * Try Demo and a sign-in to another account call `clearAccountData` from it.
 * On a closed handle the wipe call returned at once, its failure was
 * swallowed and the re-open was skipped for want of a path. Nothing on disk was touched and the call resolved as though it
 * had wiped, one tap after the athlete accepted "Continue and delete".
 *
 * Expected behaviour: a wipe asked for on a closed engine opens the database
 * and runs, and a wipe that could not run rejects rather than resolving. The
 * engine it opens has no heatmap path, since that is set only once the heatmap
 * turns on after sign-in, so the wipe is told where the tiles are.
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

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  __esModule: true,
  default: { initialize: jest.fn() },
  FfiInitOutcome: { Opened: 1, NotAttempted: 5, Failed: 6 },
  VeloqEngine: {
    create: (path: string) => mockCreate(path),
  },
}));

const DB = '/data/routes.db';

/** The handle as the login screen holds it: constructed, never opened. */
function closedClient() {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialized = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  const store = new Map<string, string>();
  mockSettings.getSetting.mockImplementation((key: string) => store.get(key) ?? null);
  mockSettings.setSetting.mockImplementation((key: string, value: string) => {
    store.set(key, value);
  });
});

describe('a wipe asked for on a closed engine', () => {
  it('opens the database given to it and wipes the real file', async () => {
    const client = closedClient();
    expect(client.ready).toBe(false);

    await client.clear(DB);

    expect(mockCreate).toHaveBeenCalledWith(DB);
    expect(mockNativeEngine.runClearAll).toHaveBeenCalled();
  });

  it('names the heatmap tiles directory to the wipe, with the heatmap never turned on', async () => {
    const client = closedClient();
    client.heatmapTilesPath = null;

    await client.clear(DB);

    expect(mockHeatmap.setTilesPath).not.toHaveBeenCalled();
    expect(mockNativeEngine.runClearAll).toHaveBeenCalledWith('/cache/heatmap-tiles/');
  });

  it('leaves the engine open on that database afterwards, as a wipe on an open one does', async () => {
    const client = closedClient();

    await client.clear(DB);

    expect(client.ready).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any).dbPath).toBe(DB);
  });

  it('rejects rather than reporting a wipe it never ran', async () => {
    const client = closedClient();

    await expect(client.clear()).rejects.toThrow();
    expect(mockNativeEngine.runClearAll).not.toHaveBeenCalled();
  });

  it('rejects when the database it was given will not open', async () => {
    const client = closedClient();
    mockCreate.mockImplementationOnce(
      () => ({ ...mockNativeEngine, isInitialized: () => false }) as never
    );

    await expect(client.clear(DB)).rejects.toThrow();
  });

  it('still reports a wipe that started and then failed', async () => {
    const client = closedClient();
    mockNativeEngine.runClearAll.mockImplementationOnce(() =>
      Promise.reject(new Error('Clear thread died without a result'))
    );

    await expect(client.clear(DB)).rejects.toThrow();
  });
});
