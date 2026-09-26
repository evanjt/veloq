/**
 * Scenario: the login screen holds a closed engine by design, and the wipe it
 * asks for went to a handle that could not run it. `clearAccountData` said
 * nothing about that and resolved, so the athlete who had just accepted
 * "Continue and delete" kept every row.
 *
 * Expected behaviour: the wipe carries the database path, so a closed handle
 * opens the real file and wipes it.
 */

import { clearAccountData } from '@/shared/storage';
import { getEngine, getRouteDbPath } from '@/shared/native/engine';

const mockSettings = new Map<string, string>();

jest.mock('@/shared/storage/settingsStorage', () => ({
  getSetting: jest.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
  removeSetting: jest.fn(async (key: string) => {
    mockSettings.delete(key);
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async () => {
    throw new Error('File not found');
  }),
  deleteAsync: jest.fn(async () => {}),
  readDirectoryAsync: jest.fn(async () => []),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    removeItem: jest.fn(async () => {}),
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {}),
  },
}));

const mockEngine = { clear: jest.fn(async () => {}) };

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => mockEngine),
  isEngineReady: jest.fn(() => false),
  getRouteDbPath: jest.fn(() => '/mock/docs/routes.db'),
}));

beforeEach(() => {
  mockSettings.clear();
  jest.clearAllMocks();
});

describe('an account wipe from a screen whose engine is closed', () => {
  it('hands the wipe the database path, so a closed handle has one to open', async () => {
    await clearAccountData({ clear: () => {} });

    expect(mockEngine.clear).toHaveBeenCalledWith('/mock/docs/routes.db');
  });

  it('carries the failure rather than reporting a wipe that did not run', async () => {
    mockEngine.clear.mockRejectedValueOnce(new Error('database is locked'));

    await expect(clearAccountData({ clear: () => {} })).rejects.toThrow('database is locked');
  });

  it('asks for the wipe with nothing to open rather than skipping it', async () => {
    (getRouteDbPath as jest.Mock).mockReturnValueOnce(null);

    await clearAccountData({ clear: () => {} });

    expect(getEngine()).toBe(mockEngine);
    expect(mockEngine.clear).toHaveBeenCalledWith(undefined);
  });
});
