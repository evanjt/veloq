/**
 * Tests for sync progress notification functions.
 * Verifies that sync notifications use the correct identifier, channel, and sticky flag,
 * and that the notification handler differentiates sync from insight notifications.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('sync-progress'),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3, LOW: 2 },
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('@/theme', () => ({
  brand: { orange: '#FC4C02' },
}));

import {
  updateSyncNotification,
  dismissSyncNotification,
  initializeNotifications,
} from '@/lib/notifications/notificationService';

describe('updateSyncNotification', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts notification with fixed identifier for in-place updates', async () => {
    await updateSyncNotification('Downloading GPS data... 5/20');

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'sync-progress',
        trigger: null,
      })
    );
  });

  it('sets sticky: true so Android users cannot swipe away', async () => {
    await updateSyncNotification('Downloading...');

    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.sticky).toBe(true);
  });

  it('uses veloq-sync channel on Android', async () => {
    const origPlatform = Platform.OS;
    (Platform as { OS: string }).OS = 'android';

    await updateSyncNotification('Downloading...');

    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.channelId).toBe('veloq-sync');

    (Platform as { OS: string }).OS = origPlatform;
  });

  it('omits channelId on iOS', async () => {
    const origPlatform = Platform.OS;
    (Platform as { OS: string }).OS = 'ios';

    await updateSyncNotification('Downloading...');

    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.channelId).toBeUndefined();

    (Platform as { OS: string }).OS = origPlatform;
  });
});

describe('dismissSyncNotification', () => {
  beforeEach(() => jest.clearAllMocks());

  it('dismisses the sync-progress notification', async () => {
    await dismissSyncNotification();

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('sync-progress');
  });
});

describe('notification handler differentiation', () => {
  it('suppresses alerts for sync-progress notifications', () => {
    initializeNotifications();

    const handlerCall = (Notifications.setNotificationHandler as jest.Mock).mock.calls[0][0];
    const syncNotification = {
      request: { identifier: 'sync-progress' },
    } as Notifications.Notification;

    return handlerCall
      .handleNotification(syncNotification)
      .then((result: Notifications.NotificationBehavior) => {
        expect(result.shouldShowAlert).toBe(false);
      });
  });

  it('shows alerts for insight notifications', () => {
    initializeNotifications();

    const handlerCall = (Notifications.setNotificationHandler as jest.Mock).mock.calls[0][0];
    const insightNotification = {
      request: { identifier: 'some-insight-uuid' },
    } as Notifications.Notification;

    return handlerCall
      .handleNotification(insightNotification)
      .then((result: Notifications.NotificationBehavior) => {
        expect(result.shouldShowAlert).toBe(true);
      });
  });
});
