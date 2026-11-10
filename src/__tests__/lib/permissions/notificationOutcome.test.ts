/**
 * Scenario: the system rejects a notification permission request, for example
 * when the platform module's context is gone, instead of answering it.
 *
 * Expected behaviour: the caller gets an outcome, read as blocked, and never a
 * rejection; a later request still answers normally.
 */

import * as Notifications from 'expo-notifications';

import { requestNotificationPermissionOutcome } from '@/shared/app/permissions/notifications';

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;

beforeEach(() => {
  getPermissions.mockReset().mockResolvedValue({ status: 'denied', canAskAgain: true });
  requestPermissions.mockReset();
});

describe('requestNotificationPermissionOutcome', () => {
  it('reads a rejected request as blocked rather than throwing', async () => {
    requestPermissions.mockRejectedValue(new Error('ERR_PERMISSIONS_REQUEST_NOTIFICATIONS'));
    await expect(requestNotificationPermissionOutcome()).resolves.toBe('blocked');
  });

  it('reads a rejected read as blocked rather than throwing', async () => {
    getPermissions.mockRejectedValue(new Error('ReactContextLost'));
    await expect(requestNotificationPermissionOutcome()).resolves.toBe('blocked');
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('answers a second request normally after a rejected one', async () => {
    requestPermissions
      .mockRejectedValueOnce(new Error('ModuleNotFoundException'))
      .mockResolvedValueOnce({ status: 'granted', canAskAgain: true });
    await expect(requestNotificationPermissionOutcome()).resolves.toBe('blocked');
    await expect(requestNotificationPermissionOutcome()).resolves.toBe('granted');
  });
});
