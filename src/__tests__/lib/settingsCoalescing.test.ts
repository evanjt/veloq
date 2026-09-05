/**
 * Scenario: a launch restores a dozen stores, each persisting what it just
 * read, and every write is its own durable commit on the thread that asked.
 *
 * Expected behaviour: writes issued in the same tick reach the engine as one
 * batch, each key keeps its last value, and a caller that awaits its write
 * still knows when the value is stored.
 */

import {
  setSetting,
  getSetting,
  removeSetting,
  flushSettingWrites,
} from '@/shared/storage/settingsStorage';

const mockSetSettings = jest.fn().mockReturnValue(3);
const mockGetSetting = jest.fn().mockReturnValue(undefined);
const mockDeleteSetting = jest.fn();
const mockSetSettingOne = jest.fn();

let mockEngineHasBatch = true;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    setSettings: mockEngineHasBatch ? mockSetSettings : undefined,
    setSetting: mockSetSettingOne,
    getSetting: mockGetSetting,
    deleteSetting: mockDeleteSetting,
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockEngineHasBatch = true;
  mockSetSettings.mockReturnValue(3);
});

describe('settings written in one tick', () => {
  it('reach the engine as a single batch', async () => {
    await Promise.all([
      setSetting('theme', 'dark'),
      setSetting('units', 'metric'),
      setSetting('sport', 'Ride'),
    ]);

    expect(mockSetSettings).toHaveBeenCalledTimes(1);
    expect(mockSetSettings).toHaveBeenCalledWith([
      { key: 'theme', value: 'dark' },
      { key: 'units', value: 'metric' },
      { key: 'sport', value: 'Ride' },
    ]);
    expect(mockSetSettingOne).not.toHaveBeenCalled();
  });

  it('keep the last value written for a key', async () => {
    await Promise.all([setSetting('theme', 'dark'), setSetting('theme', 'light')]);

    expect(mockSetSettings).toHaveBeenCalledWith([{ key: 'theme', value: 'light' }]);
  });

  it('do not leak into the next tick', async () => {
    await setSetting('theme', 'dark');
    await setSetting('units', 'metric');

    expect(mockSetSettings).toHaveBeenCalledTimes(2);
  });

  it('resolve their callers even when the engine throws', async () => {
    mockSetSettings.mockImplementation(() => {
      throw new Error('database is locked');
    });

    await expect(setSetting('theme', 'dark')).resolves.toBeUndefined();
  });

  it('are all on disk once the flush is awaited', async () => {
    const pending = setSetting('theme', 'dark');
    await flushSettingWrites();

    expect(mockSetSettings).toHaveBeenCalledTimes(1);
    await pending;
  });

  it('are readable before the batch has been committed', async () => {
    const pending = setSetting('theme', 'dark');

    await expect(getSetting('theme')).resolves.toBe('dark');
    await pending;
  });

  it('do not resurrect a key removed in the same tick', async () => {
    const pending = setSetting('theme', 'dark');
    await removeSetting('theme');
    await pending;

    expect(mockSetSettings).not.toHaveBeenCalledWith([{ key: 'theme', value: 'dark' }]);
    expect(mockDeleteSetting).toHaveBeenCalledWith('theme');
  });

  it('fall back to one write each when the engine has no batch call', async () => {
    mockEngineHasBatch = false;

    await Promise.all([setSetting('theme', 'dark'), setSetting('units', 'metric')]);

    expect(mockSetSettings).not.toHaveBeenCalled();
    expect(mockSetSettingOne).toHaveBeenCalledWith('theme', 'dark');
    expect(mockSetSettingOne).toHaveBeenCalledWith('units', 'metric');
  });
});
