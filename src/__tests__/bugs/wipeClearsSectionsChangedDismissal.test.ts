/**
 * Scenario: the athlete dismissed the sections-changed card, and then signed
 * out or cleared the library. The dismissal was kept in the settings table and
 * in the store, so the next athlete's library never showed the card.
 *
 * Expected behaviour: the account wipe forgets the dismissal, in the store and
 * in storage, so the card returns for the next library it describes.
 */

import { clearAccountData } from '@/shared/storage';
import { getSetting, setSetting } from '@/shared/storage/settingsStorage';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';

const SECTIONS_CHANGED_KEY = 'veloq-sections-changed-dismissed';
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
  ...jest.requireActual('expo-file-system/legacy'),
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

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => null),
  getRouteDbPath: jest.fn(() => '/mock/docs/routes.db'),
  isEngineReady: jest.fn(() => false),
}));

jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  registerPushToken: jest.fn(async () => true),
  unregisterPushToken: jest.fn(async () => true),
}));

beforeEach(() => {
  mockSettings.clear();
  useWhatsNewStore.setState({ sectionsChangedDismissed: [] });
});

describe('an account wipe and the sections-changed card', () => {
  it('forgets a dismissal the previous athlete made, in the store and in storage', async () => {
    await useWhatsNewStore.getState().dismissSectionsChanged('owed');
    expect(useWhatsNewStore.getState().sectionsChangedDismissed).toEqual(['owed']);
    expect(await getSetting(SECTIONS_CHANGED_KEY)).not.toBeNull();

    await clearAccountData({ clear: () => {} });

    expect(useWhatsNewStore.getState().sectionsChangedDismissed).toEqual([]);
    expect(await getSetting(SECTIONS_CHANGED_KEY)).toBeNull();
  });

  it('lets the card return after the wipe for a dismissal made before it', async () => {
    await setSetting(SECTIONS_CHANGED_KEY, JSON.stringify(['owed', 'final']));
    await useWhatsNewStore.getState().initialise();
    expect(useWhatsNewStore.getState().sectionsChangedDismissed).toEqual(['owed', 'final']);

    await clearAccountData({ clear: () => {} });
    await useWhatsNewStore.getState().initialise();

    expect(useWhatsNewStore.getState().sectionsChangedDismissed).toEqual([]);
  });
});
