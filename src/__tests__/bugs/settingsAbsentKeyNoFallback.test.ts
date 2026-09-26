/**
 * Scenario: a launch restores seventeen stores, each reading its key through
 * `getSetting`. Most keys have never been written on a fresh install.
 *
 * Expected behaviour: once the one-time AsyncStorage to SQLite migration has
 * run, an absent key is absent. Consulting AsyncStorage for it is an async
 * bridge round trip per key per launch that can never find anything.
 */

const mockGetSetting = jest.fn().mockReturnValue(undefined);
const mockGetItem = jest.fn().mockResolvedValue(null);

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: mockGetSetting,
    setSetting: jest.fn(),
    setSettings: jest.fn(),
    deleteSetting: jest.fn(),
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: (...args: string[]) => mockGetItem(...args),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const SENTINEL = '__settings_migrated';

/** Fresh module state per case: the sentinel is cached once it is seen. */
function loadStorage(): typeof import('@/shared/storage/settingsStorage') {
  let mod!: typeof import('@/shared/storage/settingsStorage');
  jest.isolateModules(() => {
    mod = require('@/shared/storage/settingsStorage');
  });
  return mod;
}

/** The engine answers the sentinel and nothing else. */
function migrated(done: boolean): void {
  mockGetSetting.mockImplementation((key: string) => (key === SENTINEL && done ? '1' : undefined));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
});

describe('an absent setting after the migration', () => {
  it('does not reach AsyncStorage', async () => {
    migrated(true);
    const { getSetting } = loadStorage();

    await expect(getSetting('veloq-debug-mode')).resolves.toBeNull();
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('costs one sentinel read however many keys a launch asks for', async () => {
    migrated(true);
    const { getSetting } = loadStorage();

    for (const key of ['a', 'b', 'c', 'd', 'e']) await getSetting(key);

    const sentinelReads = mockGetSetting.mock.calls.filter(([key]) => key === SENTINEL).length;
    expect(sentinelReads).toBe(1);
  });

  it('still reads AsyncStorage before the migration has run', async () => {
    migrated(false);
    mockGetItem.mockResolvedValue('dark');
    const { getSetting } = loadStorage();

    await expect(getSetting('veloq-theme-preference')).resolves.toBe('dark');
    expect(mockGetItem).toHaveBeenCalledWith('veloq-theme-preference');
  });

  it('stops reaching AsyncStorage as soon as the migration lands mid-session', async () => {
    migrated(false);
    const { getSetting } = loadStorage();
    await getSetting('veloq-debug-mode');
    expect(mockGetItem).toHaveBeenCalledTimes(1);

    migrated(true);
    await getSetting('veloq-debug-mode');

    expect(mockGetItem).toHaveBeenCalledTimes(1);
  });

  /** A stored value is a stored value, and the sentinel never gets a look in. */
  it('answers a key the engine holds without consulting the sentinel', async () => {
    mockGetSetting.mockImplementation((key: string) => (key === SENTINEL ? '1' : 'stored'));
    const { getSetting } = loadStorage();

    await expect(getSetting('veloq-unit-preference')).resolves.toBe('stored');
    expect(mockGetSetting).toHaveBeenCalledTimes(1);
  });

  /** With no engine at all there is nothing to trust, so the fallback stands. */
  it('reads AsyncStorage when the engine is not open', async () => {
    jest.doMock('@/shared/native/engine', () => ({ getEngine: () => null }));
    mockGetItem.mockResolvedValue('en-AU');
    const { getSetting } = loadStorage();

    await expect(getSetting('veloq-language-preference')).resolves.toBe('en-AU');
    jest.dontMock('@/shared/native/engine');
  });
});
