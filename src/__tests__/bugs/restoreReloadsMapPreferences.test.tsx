/**
 * Scenario: the athlete restores a backup whose map preferences and per-activity
 * overrides differ from what the mounted provider holds, then changes one map
 * option.
 *
 * Expected behaviour: the restore reloads the provider, and the next change
 * writes the restored values rather than the pre-restore ones.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { reinitialiseAllStores } from '@/features/settings/lib/backup';
import {
  MapPreferencesProvider,
  useMapPreferences,
} from '@/features/settings/stores/MapPreferencesContext';

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
  removeSetting: jest.fn().mockImplementation(async (key: string) => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.removeItem(key);
  }),
  rememberStoredActivityCount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/shared/app/ThemeProvider', () => ({
  initialiseTheme: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/app/LanguageStore', () => ({
  initialiseLanguage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/app/UnitPreferenceStore', () => ({
  initialiseUnitPreference: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/fitness/stores', () => ({
  initialiseSportPreference: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/summaryCardPreferences', () => ({
  initialiseDashboardPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/insights/store', () => ({
  initialiseInsightsStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/recording/stores/RecordingPreferencesStore', () => ({
  initialiseRecordingPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  initialiseRouteSettings: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/DebugStore', () => ({
  initialiseDebugStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/NotificationPreferencesStore', () => ({
  initialiseNotificationPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/NotificationPromptStore', () => ({
  initialiseNotificationPrompt: jest.fn().mockResolvedValue(undefined),
  useNotificationPrompt: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('@/shared/app/SupportStore', () => ({
  initialiseSupportStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/WhatsNewStore', () => ({
  initialiseWhatsNewStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/maps/lib/storage/mapCameraState', () => ({
  reloadMapCameraState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  ...jest.requireActual('@/features/maps/lib/storage/terrainCameraOverrides'),
  reloadCameraOverrides: jest.fn().mockResolvedValue(undefined),
}));

const PREFERENCES_KEY = 'veloq-map-preferences';
const OVERRIDES_KEY = 'veloq-map-activity-overrides';

type MapPreferencesValue = ReturnType<typeof useMapPreferences>;

function mountProvider(): { current: () => MapPreferencesValue } {
  let latest: MapPreferencesValue | undefined;
  function Probe() {
    latest = useMapPreferences();
    return null;
  }
  render(
    <MapPreferencesProvider>
      <Probe />
    </MapPreferencesProvider>
  );
  return { current: () => latest as MapPreferencesValue };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('a restore reloads the map preferences provider', () => {
  it('shows the restored style and overrides, and keeps them through the next change', async () => {
    await AsyncStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ defaultStyle: 'light', activityTypeStyles: {}, terrain3DMode: 'off' })
    );
    const probe = mountProvider();
    await waitFor(() => expect(probe.current().isLoaded).toBe(true));
    expect(probe.current().preferences.defaultStyle).toBe('light');

    await AsyncStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ defaultStyle: 'satellite', activityTypeStyles: {}, terrain3DMode: 'off' })
    );
    await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify({ a1: { style: 'dark' } }));
    await act(async () => {
      await reinitialiseAllStores();
    });

    expect(probe.current().preferences.defaultStyle).toBe('satellite');
    expect(probe.current().getActivityOverride('a1')).toEqual({ style: 'dark' });

    await act(async () => {
      await probe.current().setTerrain3DMode(null, 'always');
    });

    const stored = JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY)) as string);
    expect(stored.defaultStyle).toBe('satellite');
    expect(stored.terrain3DMode).toBe('always');
    expect(JSON.parse((await AsyncStorage.getItem(OVERRIDES_KEY)) as string)).toEqual({
      a1: { style: 'dark' },
    });
  });

  it('clears overrides the restored backup does not carry', async () => {
    await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify({ a1: { style: 'dark' } }));
    const probe = mountProvider();
    await waitFor(() => expect(probe.current().getActivityOverride('a1')).toBeDefined());

    await AsyncStorage.removeItem(OVERRIDES_KEY);
    await act(async () => {
      await reinitialiseAllStores();
    });

    expect(probe.current().getActivityOverride('a1')).toBeUndefined();
  });
});
