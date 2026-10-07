/**
 * Scenario: a signed-out launch, a failed open or an unloaded native module
 * leaves the engine unopened, so preference reads and writes have no SQLite.
 * The handle may be null, or the singleton whose `getSetting` answers
 * `undefined` and whose `setSettings` returns 0.
 *
 * Expected behaviour: AsyncStorage answers those reads and keeps those writes.
 * Treating the fallback as transitional would empty every preference on those
 * launches with nothing failing loudly to say so.
 */

const mockSetSettings = jest.fn();
const mockGetItem = jest.fn().mockResolvedValue(null);
const mockSetItem = jest.fn().mockResolvedValue(undefined);
const mockRemoveItem = jest.fn().mockResolvedValue(undefined);

let mockEngine: Record<string, unknown> | null = null;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: (...args: string[]) => mockSetItem(...args),
  getItem: (...args: string[]) => mockGetItem(...args),
  removeItem: (...args: string[]) => mockRemoveItem(...args),
}));

function loadStorage(): typeof import('@/shared/storage/settingsStorage') {
  let mod!: typeof import('@/shared/storage/settingsStorage');
  jest.isolateModules(() => {
    mod = require('@/shared/storage/settingsStorage');
  });
  return mod;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEngine = null;
});

describe('a preference read before the engine exists', () => {
  it('is answered by AsyncStorage', async () => {
    mockGetItem.mockResolvedValueOnce('dark');
    const storage = loadStorage();

    await expect(storage.getSetting('theme')).resolves.toBe('dark');
    expect(mockGetItem).toHaveBeenCalledWith('theme');
  });

  it('is answered as absent when AsyncStorage has nothing either', async () => {
    const storage = loadStorage();
    await expect(storage.getSetting('theme')).resolves.toBeNull();
  });
});

describe('a preference write before the engine exists', () => {
  it('is kept by AsyncStorage, though SQLite drops it', async () => {
    const storage = loadStorage();

    await storage.setSetting('theme', 'dark');

    expect(mockSetItem).toHaveBeenCalledWith('theme', 'dark');
    expect(mockSetSettings).not.toHaveBeenCalled();
  });

  it('is readable back in the same session once the engine arrives empty', async () => {
    const storage = loadStorage();
    await storage.setSetting('units', 'metric');

    mockEngine = { getSetting: () => undefined, setSettings: mockSetSettings };
    mockGetItem.mockResolvedValueOnce('metric');

    await expect(storage.getSetting('units')).resolves.toBe('metric');
  });

  it('is removed from AsyncStorage even with no engine to remove it from', async () => {
    const storage = loadStorage();
    await storage.removeSetting('theme');
    expect(mockRemoveItem).toHaveBeenCalledWith('theme');
  });
});

describe('an engine handle that has not opened', () => {
  it('answers reads from AsyncStorage when getSetting is undefined', async () => {
    mockEngine = { getSetting: () => undefined, setSettings: () => 0 };
    mockGetItem.mockResolvedValueOnce('dark');
    const storage = loadStorage();

    await expect(storage.getSetting('theme')).resolves.toBe('dark');
  });

  it('keeps a write in AsyncStorage when setSettings returns 0', async () => {
    mockEngine = { getSetting: () => undefined, setSettings: mockSetSettings.mockReturnValue(0) };
    const storage = loadStorage();

    await storage.setSetting('theme', 'dark');

    expect(mockSetItem).toHaveBeenCalledWith('theme', 'dark');
    expect(mockSetSettings).toHaveBeenCalledWith([{ key: 'theme', value: 'dark' }]);
  });
});
