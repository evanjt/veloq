/**
 * Scenario: the store initialisers run before `initWithPath`, so every
 * preference read and write at cold start happens with no engine at all.
 *
 * Expected behaviour: AsyncStorage answers those reads and keeps those writes.
 * The header on `settingsStorage` called the fallback transitional, and acting
 * on that would empty every preference on every launch with nothing failing
 * loudly to say so, so this is what holds it in place.
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
