/**
 * Scenario: the library is reopened in the same process, by a wipe, a snapshot
 * rollback or an identity change. The engine handle is the same singleton, but
 * the database under it is a different file, and the new one has never run the
 * AsyncStorage to SQLite migration.
 *
 * Expected behaviour: once a reopen lands on a library with no migration
 * sentinel, an absent preference is asked of AsyncStorage again, as it is on a
 * fresh install. A migrated library keeps the cached answer.
 */

const SENTINEL = '__settings_migrated';
const DB = '/library/routes.db';

let mockSentinelPresent = false;
const mockEngine = {
  getSetting: jest.fn((key: string) => (key === SENTINEL && mockSentinelPresent ? '1' : undefined)),
  setSetting: jest.fn(),
  setSettings: jest.fn(),
  deleteSetting: jest.fn(),
  initWithPath: jest.fn(() => true),
};
const mockGetItem = jest.fn().mockResolvedValue(null);

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: (...args: string[]) => mockGetItem(...args),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/shared/native/backupExclusion', () => ({
  excludeExistingFromBackup: jest.fn(() => true),
}));

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return false;
    }
    create() {}
  },
}));

/** Both modules come from one registry, so the reopen reaches the same latch the read consults. */
function load(): {
  storage: typeof import('@/shared/storage/settingsStorage');
  library: typeof import('@/shared/storage/routeDbLocation');
} {
  let mods!: {
    storage: typeof import('@/shared/storage/settingsStorage');
    library: typeof import('@/shared/storage/routeDbLocation');
  };
  jest.isolateModules(() => {
    mods = {
      storage: require('@/shared/storage/settingsStorage'),
      library: require('@/shared/storage/routeDbLocation'),
    };
  });
  return mods;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSentinelPresent = false;
});

describe('a preference read after the library is reopened', () => {
  it('is asked of AsyncStorage when the new library has no migration sentinel', async () => {
    mockSentinelPresent = true;
    const { storage, library } = load();
    await storage.getSetting('veloq-debug-mode');

    mockSentinelPresent = false;
    library.openLibrary(mockEngine, DB);
    mockGetItem.mockResolvedValueOnce('dark');

    await expect(storage.getSetting('veloq-theme-preference')).resolves.toBe('dark');
    expect(mockGetItem).toHaveBeenCalledWith('veloq-theme-preference');
  });

  it('stops reaching AsyncStorage once the migration lands on the reopened library', async () => {
    mockSentinelPresent = true;
    const { storage, library } = load();
    await storage.getSetting('veloq-debug-mode');

    mockSentinelPresent = false;
    library.openLibrary(mockEngine, DB);
    await storage.getSetting('veloq-theme-preference');
    expect(mockGetItem).toHaveBeenCalledTimes(1);

    mockSentinelPresent = true;
    await storage.getSetting('veloq-unit-preference');

    expect(mockGetItem).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached answer across a reopen of a library already migrated', async () => {
    mockSentinelPresent = true;
    const { storage, library } = load();
    await storage.getSetting('veloq-debug-mode');

    library.openLibrary(mockEngine, DB);
    await storage.getSetting('veloq-theme-preference');

    expect(mockGetItem).not.toHaveBeenCalled();
  });
});
