/** Account change protection for a library with saved activities. */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { accountChangeAction, promptAccountMismatch } from '@/features/auth/lib/accountChange';
import { readCachedAthleteIdMirror } from '@/shared/storage/cachedAthleteId';

// The maps barrel reaches the engine binding, which registers a TurboModule at
// import time, so the graph this renders cannot load without the stub.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
const mockEngine = {
  destroyEngine: jest.fn(),
  getActivityCount: jest.fn().mockReturnValue(80),
  clearRecordings: jest.fn(),
  notifyAll: jest.fn(),
  getSetting: jest.fn().mockReturnValue(null),
  setSetting: jest.fn(),
  deleteSetting: jest.fn(),
  clear: jest.fn(),
  getStats: jest.fn().mockReturnValue({ activityCount: 0, newestDate: null }),
};

let mockAthleteId: string | null = null;
const mockClearCredentials = jest.fn();

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: (buf: ArrayBuffer) =>
      (buf as unknown as { points?: { latitude: number; longitude: number }[] }).points ?? [],
  })
);
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/data/veloq.db',
  isEngineReady: () => true,
}));

jest.mock('@/shared/app/AuthStore', () => ({
  DEMO_ATHLETE_ID: 'demo',
  useAuthStore: {
    getState: () => ({ athleteId: mockAthleteId, clearCredentials: mockClearCredentials }),
  },
  releasePushRegistration: jest.fn(async () => undefined),
}));

jest.mock('@/shared/query/QueryProvider', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareFile: jest.fn().mockResolvedValue(undefined),
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
  useInsightsStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  initializeTileCacheSettings: jest.fn().mockResolvedValue(undefined),
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
  useNotificationPreferences: { getState: () => ({ reset: jest.fn() }) },
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
  forgetMapCameraState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  reloadCameraOverrides: jest.fn().mockResolvedValue(undefined),
  forgetCameraOverrides: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(async () => {
  mockAthleteId = null;
  mockClearCredentials.mockReset();
  mockEngine.setSetting.mockReset();
  mockEngine.clear.mockReset();
  // A restore from the login screen lands on a fresh install, which holds
  // nothing and is never asked to confirm the trade.
  mockEngine.getActivityCount.mockReset().mockReturnValue(0);
  mockEngine.getSetting.mockReset().mockReturnValue(null);
  await AsyncStorage.clear();
});

describe('a library nothing has named', () => {
  it('is confirmed before a wipe, on the count alone', () => {
    expect(accountChangeAction(null, 'demo', 80)).toBe('confirm-then-wipe');
  });

  it('is kept silently when there is nothing on the device', () => {
    expect(accountChangeAction(null, 'demo', 0)).toBe('keep');
  });

  it('does not ask when the incoming athlete is the cached one', () => {
    expect(accountChangeAction('athlete-9', 'athlete-9', 80)).toBe('keep');
  });

  it('still wipes leftover demo fixtures without asking', () => {
    expect(accountChangeAction('demo', 'athlete-9', 80)).toBe('wipe');
  });
});

describe('the restored-identity prompt', () => {
  function press(label: 'cancel' | 'destructive') {
    (Alert.alert as jest.Mock).mockImplementation((_t, _m, buttons) => {
      const button = buttons.find((b: { style?: string }) =>
        label === 'cancel' ? b.style === 'cancel' : b.style === 'destructive'
      );
      button.onPress();
    });
  }

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('clears nothing until the athlete accepts', async () => {
    press('cancel');

    const cleared = await promptAccountMismatch({
      storedAthleteId: 'athlete-9',
      credentialsAthleteId: 'athlete-1',
      activityCount: 500,
    });

    expect(cleared).toBe(false);
    expect(mockEngine.clear).not.toHaveBeenCalled();
    expect(mockClearCredentials).toHaveBeenCalled();
  });

  it('clears and re-stamps once the athlete accepts', async () => {
    press('destructive');

    const cleared = await promptAccountMismatch({
      storedAthleteId: 'athlete-9',
      credentialsAthleteId: 'athlete-1',
      activityCount: 500,
    });

    expect(cleared).toBe(true);
    expect(mockEngine.clear).toHaveBeenCalled();
    expect(mockEngine.setSetting).toHaveBeenCalledWith('__athlete_id', 'athlete-1');
    await expect(readCachedAthleteIdMirror()).resolves.toBe('athlete-1');
  });
});
