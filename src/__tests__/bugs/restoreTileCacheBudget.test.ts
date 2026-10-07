/**
 * Scenario: the device is set to a 400 MB tile ceiling and the athlete restores
 * a backup made at 100 MB. The restore replaced the key and re-armed every
 * store, but the tile settings were only migrated, never reloaded, so settings
 * and every map page built that session kept 400 MB until the next launch
 * quietly took 100.
 *
 * Expected behaviour: the restore reloads the ceiling and the Rust store is
 * handed the new byte count.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { reinitializeAllStores } from '@/features/settings/lib/backup';
import {
  getTileCacheBudgetMb,
  useTileCacheSettings,
} from '@/features/maps/lib/storage/tileCacheSettings';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => null,
  isEngineReady: () => false,
}));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockImplementation((key: string) => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    return AsyncStorage.getItem(key);
  }),
  setSetting: jest.fn().mockImplementation(async (key: string, value: string) => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(key, value);
  }),
  removeSetting: jest.fn().mockResolvedValue(undefined),
  rememberStoredActivityCount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/shared/app/ThemeProvider', () => ({
  initializeTheme: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/app/LanguageStore', () => ({
  initializeLanguage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/app/UnitPreferenceStore', () => ({
  initializeUnitPreference: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/fitness/stores', () => ({
  initializeSportPreference: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/home/store', () => ({
  initializeDashboardPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/insights/store', () => ({
  initializeInsightsStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/recording/stores/RecordingPreferencesStore', () => ({
  initializeRecordingPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  initializeRouteSettings: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/DebugStore', () => ({
  initializeDebugStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/NotificationPreferencesStore', () => ({
  initializeNotificationPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/NotificationPromptStore', () => ({
  initializeNotificationPrompt: jest.fn().mockResolvedValue(undefined),
  useNotificationPrompt: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('@/shared/app/SupportStore', () => ({
  initializeSupportStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/WhatsNewStore', () => ({
  initializeWhatsNewStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/maps/lib/storage/mapCameraState', () => ({
  reloadMapCameraState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  reloadCameraOverrides: jest.fn().mockResolvedValue(undefined),
}));

const TILE_CACHE_KEY = 'veloq-tile-cache';
const MB = 1_000_000;

function basemap() {
  return jest.requireMock('veloqrs').basemapStore();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('a restore reloads the tile cache budget', () => {
  it('takes the restored ceiling and hands Rust the bytes', async () => {
    await useTileCacheSettings.getState().setBudgetMb(400);
    expect(getTileCacheBudgetMb()).toBe(400);
    basemap().setBudget.mockClear();

    await AsyncStorage.setItem(TILE_CACHE_KEY, JSON.stringify({ budgetMb: 100 }));
    await reinitializeAllStores();

    expect(getTileCacheBudgetMb()).toBe(100);
    expect(basemap().setBudget).toHaveBeenCalledWith(100 * MB);
  });
});
