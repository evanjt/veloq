/**
 * Scenario: three surfaces wipe the engine and carry on using it. The identity
 * write after "Clear & Sync" is the one that fails loudest, since the whole
 * branch exists to make it, and a no-op on a closed handle leaves the next
 * launch believing it holds the previous athlete's library.
 *
 * Expected behaviour: a clear leaves an open engine on the same database it
 * just wiped, so a write straight after it lands.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const mockSettings = { getSetting: jest.fn(), setSetting: jest.fn() };
const mockNativeEngine = {
  isInitialized: () => true,
  setObserver: jest.fn(),
  clear: jest.fn(),
  destroy: jest.fn(),
  settings: () => mockSettings,
};
const mockCreate = jest.fn((_dbPath: string) => mockNativeEngine);

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
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

  it('leaves the engine open on the database it just wiped', () => {
    const client = openClient();

    client.clear();

    expect(client.isInitialized()).toBe(true);
    expect(mockNativeEngine.clear).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenLastCalledWith(DB);
  });

  it('lands the identity write that follows a clear', () => {
    const client = openClient();

    client.clear();
    client.setSetting('__athlete_id', 'a-99');

    expect(client.getSetting('__athlete_id')).toBe('a-99');
  });

  it('re-registers the observer, so the reopened engine still announces', () => {
    const client = openClient();
    mockNativeEngine.setObserver.mockClear();

    client.clear();

    expect(mockNativeEngine.setObserver).toHaveBeenCalledTimes(1);
  });

  it('reports a clear it could not reopen rather than claiming an engine', () => {
    const client = openClient();
    mockCreate.mockImplementationOnce(() => {
      throw new Error('database is locked');
    });

    client.clear();

    expect(client.isInitialized()).toBe(false);
    expect(client.getSetting('__athlete_id')).toBeUndefined();
  });

  it('clears nothing and opens nothing when no database was ever opened', () => {
    const client = EngineClient.getInstance();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).initialized = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).dbPath = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).engine = null;
    mockCreate.mockClear();

    client.clear();

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
