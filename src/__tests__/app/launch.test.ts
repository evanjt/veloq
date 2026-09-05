/**
 * Scenario: a cold start with credentials in the keychain and a library on
 * disk. Every store's first read should come out of SQLite, which means the
 * engine has to be open before the stores are restored.
 *
 * Expected behaviour: the engine opens once auth resolves and before any
 * setting is read, no read falls through to AsyncStorage, the tile cache key
 * is read once, i18n still starts on the saved language, the launch is
 * marked step by step, and nothing probes the engine for a legacy purchaser.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { initializeApp } from '@/app/launch';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useLanguageStore } from '@/shared/app/LanguageStore';
import { i18n } from '@/i18n';
import { initializeDebugStore } from '@/features/settings/stores/DebugStore';

type Call = { name: string; key?: string };

const calls: Call[] = [];
const stored = new Map<string, string>();

let mockEngineOpen = false;

const mockEngine = {
  get ready(): boolean {
    return mockEngineOpen;
  },
  initWithPath: jest.fn((path: string): boolean => {
    calls.push({ name: 'initWithPath', key: path });
    mockEngineOpen = true;
    return true;
  }),
  getSetting: jest.fn((key: string): string | undefined => {
    calls.push({ name: 'getSetting', key });
    return mockEngineOpen ? stored.get(key) : undefined;
  }),
  setSetting: jest.fn(),
  setSettings: jest.fn(),
  deleteSetting: jest.fn(),
  getActivityCount: jest.fn(() => {
    calls.push({ name: 'getActivityCount' });
    return 408;
  }),
  setSyncCredentials: jest.fn(),
  clearSyncCredentials: jest.fn(),
};

jest.mock('@/features/settings/stores/DebugStore', () => ({
  initializeDebugStore: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/data/routes.db',
  isEngineReady: () => mockEngineOpen,
  applyDetectionStrictness: jest.fn(),
}));

const secureGet = SecureStore.getItemAsync as jest.Mock;

function keychain(values: Record<string, string>): void {
  secureGet.mockImplementation((key: string) => Promise.resolve(values[key] ?? null));
}

/** Every key the launch reads, as an install that has run 0.4.0 once holds them. */
const MIGRATED_KEYS = [
  'veloq-language-preference',
  'veloq-theme-preference',
  'veloq-primary-sport',
  'veloq-unit-preference',
  'veloq-hr-zones',
  'veloq-route-settings',
  'dashboard_preferences',
  'dashboard_summary_card',
  'veloq-debug-mode',
  'veloq-tile-cache',
  'veloq-whats-new-seen',
  'veloq-insights-fingerprint',
  'veloq-recording-preferences',
  'veloq-upload-permission',
  'veloq-notification-preferences',
  'veloq-notification-prompt-dismissed',
  'veloq-support-store',
];

function migratedLibrary(): void {
  for (const key of MIGRATED_KEYS) stored.set(key, '{}');
  stored.set('veloq-language-preference', 'de-DE');
}

beforeEach(() => {
  calls.length = 0;
  stored.clear();
  mockEngineOpen = false;
  jest.clearAllMocks();
  useAuthStore.setState({ isAuthenticated: false, isLoading: true, athleteId: null });
  useLanguageStore.setState({ language: null, isInitialized: false });
});

describe('initializeApp', () => {
  it('opens the engine after auth and before any setting is read', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    migratedLibrary();
    const getItem = jest.spyOn(AsyncStorage, 'getItem');

    await expect(initializeApp()).resolves.toBeNull();

    const open = calls.findIndex((c) => c.name === 'initWithPath');
    const firstRead = calls.findIndex((c) => c.name === 'getSetting');
    expect(open).toBeGreaterThanOrEqual(0);
    expect(firstRead).toBeGreaterThan(open);
    expect(mockEngine.initWithPath).toHaveBeenCalledTimes(1);
    expect(getItem).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('falls back to storage only for a key the engine does not hold', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    migratedLibrary();
    stored.delete('veloq-unit-preference');
    const getItem = jest.spyOn(AsyncStorage, 'getItem');

    await initializeApp();

    expect(getItem.mock.calls.map(([key]) => key)).toEqual(['veloq-unit-preference']);
  });

  it('starts i18n on the saved language when the read comes from the engine', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    stored.set('veloq-language-preference', 'fr');

    await initializeApp();

    expect(useLanguageStore.getState().language).toBe('fr');
    expect(i18n.language).toBe('fr');
  });

  it('reads the tile cache key once', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    stored.set('veloq-tile-cache', JSON.stringify({ cacheMode: 'aggressive', budgetMb: 200 }));

    await initializeApp();

    const tileReads = calls.filter((c) => c.name === 'getSetting' && c.key === 'veloq-tile-cache');
    expect(tileReads).toHaveLength(1);
  });

  it('leaves the engine closed and reads storage when there are no credentials', async () => {
    keychain({});
    const getItem = jest.spyOn(AsyncStorage, 'getItem');

    await expect(initializeApp()).resolves.toBeNull();

    expect(mockEngine.initWithPath).not.toHaveBeenCalled();
    expect(getItem).toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('never probes the engine for a legacy purchaser', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });

    await initializeApp();

    expect(mockEngine.getActivityCount).not.toHaveBeenCalled();
  });

  it('marks each launch step in order', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    const mark = jest.fn();
    Object.assign(performance, { mark });

    await initializeApp();

    const names = mark.mock.calls.map(([name]) => name).filter((n) => n.startsWith('launch:'));
    expect(names).toEqual(['launch:auth', 'launch:engine', 'launch:stores']);
  });

  it('still resolves, with the first message, when an initialiser rejects', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    (initializeDebugStore as jest.Mock).mockRejectedValueOnce(new Error('debug store unreadable'));

    await expect(initializeApp()).resolves.toBe('debug store unreadable');
  });
});
