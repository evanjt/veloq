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
  it('suppresses banner but allows alert for sync-progress notifications', () => {
    initializeNotifications();

    const handlerCall = (Notifications.setNotificationHandler as jest.Mock).mock.calls[0][0];
    const syncNotification = {
      request: { identifier: 'sync-progress' },
    } as Notifications.Notification;

    return handlerCall
      .handleNotification(syncNotification)
      .then((result: Notifications.NotificationBehavior) => {
        // shouldShowBanner false suppresses iOS drop-down banner
        expect(result.shouldShowBanner).toBe(false);
        // shouldShowList true keeps it in iOS notification center and posts
        // on Android via the LOW-importance channel
        expect(result.shouldShowList).toBe(true);
        // shouldShowAlert is deprecated in expo-notifications and must not be set
        expect(result.shouldShowAlert).toBeUndefined();
      });
  });

  it('shows banner and list for insight notifications', () => {
    initializeNotifications();

    const handlerCall = (Notifications.setNotificationHandler as jest.Mock).mock.calls[0][0];
    const insightNotification = {
      request: { identifier: 'some-insight-uuid' },
    } as Notifications.Notification;

    return handlerCall
      .handleNotification(insightNotification)
      .then((result: Notifications.NotificationBehavior) => {
        expect(result.shouldShowBanner).toBe(true);
        expect(result.shouldShowList).toBe(true);
        expect(result.shouldShowAlert).toBeUndefined();
      });
  });
});

// ============================================================
// NOTIFICATION TAP HANDLER (setupNotificationResponseHandler)
// ============================================================

describe('notification tap handler', () => {
  let { router } = require('expo-router') as { router: { push: jest.Mock } };
  const { setupNotificationResponseHandler } = require('@/lib/notifications/notificationService');
  let addListenerMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    router = require('expo-router').router;
    addListenerMock = Notifications.addNotificationResponseReceivedListener as jest.Mock;
  });

  it('navigates to activity on tap with activityId', () => {
    setupNotificationResponseHandler();

    const callback = addListenerMock.mock.calls[0][0];
    const response = {
      notification: {
        request: {
          content: {
            data: { activityId: 'act-123', route: '/routes' },
          },
        },
      },
    };

    callback(response);
    expect(router.push).toHaveBeenCalledWith('/activity/act-123');
  });

  it('navigates to section when sectionId provided without activityId', () => {
    setupNotificationResponseHandler();

    const callback = addListenerMock.mock.calls[0][0];
    const response = {
      notification: {
        request: {
          content: {
            data: { sectionId: 'sec-456', route: '/routes' },
          },
        },
      },
    };

    callback(response);
    expect(router.push).toHaveBeenCalledWith('/section/sec-456');
  });

  it('falls back to route when no activityId or sectionId', () => {
    setupNotificationResponseHandler();

    const callback = addListenerMock.mock.calls[0][0];
    const response = {
      notification: {
        request: {
          content: {
            data: { route: '/fitness' },
          },
        },
      },
    };

    callback(response);
    expect(router.push).toHaveBeenCalledWith('/fitness');
  });

  it('gracefully handles missing data in notification response', () => {
    setupNotificationResponseHandler();

    const callback = addListenerMock.mock.calls[0][0];
    const response = {
      notification: {
        request: {
          content: {
            data: undefined,
          },
        },
      },
    };

    // Should not throw and should not navigate
    expect(() => callback(response)).not.toThrow();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('returns shouldShowBanner true for non-sync notifications', () => {
    initializeNotifications();

    const handlerCall = (Notifications.setNotificationHandler as jest.Mock).mock.calls[0][0];
    const insightNotification = {
      request: { identifier: 'insight-new-pr' },
    } as Notifications.Notification;

    return handlerCall
      .handleNotification(insightNotification)
      .then((result: Notifications.NotificationBehavior) => {
        expect(result.shouldShowBanner).toBe(true);
        expect(result.shouldPlaySound).toBe(false);
      });
  });

  it('returns a subscription with remove function', () => {
    const subscription = setupNotificationResponseHandler();
    expect(typeof subscription.remove).toBe('function');
  });
});
