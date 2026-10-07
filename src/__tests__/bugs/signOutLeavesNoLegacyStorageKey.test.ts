/**
 * Scenario: sign-out and the account wipe awaited an AsyncStorage removal of a
 * key nothing writes.
 *
 * Expected behaviour: neither path touches AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearAccountData, clearAuthOnly } from '@/shared/storage';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => null),
  getRouteDbPath: jest.fn(() => '/mock/docs/routes.db'),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { removeItem: jest.fn(async () => undefined) },
}));

describe('sign-out storage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('clearAuthOnly removes nothing from AsyncStorage', async () => {
    await clearAuthOnly({ clear: jest.fn() });
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it('clearAccountData removes nothing from AsyncStorage', async () => {
    await clearAccountData({ clear: jest.fn() }).catch(() => undefined);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });
});
