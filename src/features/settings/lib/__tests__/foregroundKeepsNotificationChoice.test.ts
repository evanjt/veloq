/**
 * Scenario: the athlete has notifications on, turns them off for the app in
 * system settings, and comes back. Later they turn them on again there.
 *
 * Expected behaviour: the return leaves the athlete's own choice standing and
 * keeps the token unregistered from nothing, so a re-grant in system settings
 * brings notifications back without a visit to the switch. The token is
 * refreshed only while the system allows them.
 */

import { reconcilePushRegistrationOnForeground } from '../reconcilePushRegistration';
import { useNotificationPreferences } from '../../stores/NotificationPreferencesStore';

const mockRefresh = jest.fn().mockResolvedValue(undefined);
jest.mock('../pushTokenRegistration', () => ({
  refreshPushTokenRegistration: (...a: unknown[]) => mockRefresh(...a),
  ensurePushTokenRegistered: jest.fn(),
  unregisterPushToken: jest.fn().mockResolvedValue(true),
  registerPushToken: jest.fn(),
}));

const mockGetPermissions = jest.fn();
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: jest.fn(),
}));

const mockAuth = jest.fn();
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => mockAuth() },
}));

function given(enabled: boolean) {
  useNotificationPreferences.setState({
    enabled,
    privacyAccepted: true,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockReturnValue({ athleteId: 'a1', isDemoMode: false });
});

it('keeps the choice when the system setting is off', async () => {
  given(true);
  mockGetPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });

  await reconcilePushRegistrationOnForeground();

  expect(useNotificationPreferences.getState().enabled).toBe(true);
  expect(useNotificationPreferences.getState().pendingUnregister).toBe(false);
  expect(mockRefresh).not.toHaveBeenCalled();
});

it('refreshes the token once the system setting is back on', async () => {
  given(true);
  mockGetPermissions.mockResolvedValue({ status: 'denied', canAskAgain: true });
  await reconcilePushRegistrationOnForeground();

  mockGetPermissions.mockResolvedValue({ status: 'granted', canAskAgain: true });
  await reconcilePushRegistrationOnForeground();

  expect(useNotificationPreferences.getState().enabled).toBe(true);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockRefresh).toHaveBeenCalledWith('a1');
});

it('reads nothing while the athlete has notifications off', async () => {
  given(false);

  await reconcilePushRegistrationOnForeground();

  expect(mockGetPermissions).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
});

it('refreshes nothing without a signed-in athlete', async () => {
  given(true);
  mockAuth.mockReturnValue({ athleteId: null, isDemoMode: false });
  mockGetPermissions.mockResolvedValue({ status: 'granted', canAskAgain: true });

  await reconcilePushRegistrationOnForeground();

  expect(mockRefresh).not.toHaveBeenCalled();
});

it('leaves the choice alone when the read fails', async () => {
  given(true);
  mockGetPermissions.mockRejectedValue(new Error('no native module'));

  await expect(reconcilePushRegistrationOnForeground()).resolves.toBeUndefined();

  expect(useNotificationPreferences.getState().enabled).toBe(true);
  expect(mockRefresh).not.toHaveBeenCalled();
});
