/**
 * Scenario: expo-notifications reads the Android channel from the trigger and
 * nowhere else. A channel named in `content` with `trigger: null` is dropped,
 * and the notification lands on expo's own fallback channel, which is
 * hardcoded IMPORTANCE_HIGH. Every sync progress re-post was a heads-up
 * banner because of it.
 *
 * Expected behaviour: the channel travels in the trigger, so it is the shape
 * the library consumes rather than the shape the code happened to produce.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  updateSyncNotification,
  dismissSyncNotification,
  initializeNotifications,
  presentInsightNotification,
  presentActivityNotification,
} from '@/features/settings/lib/notificationService';

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('sync-progress'),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2 },
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
}));

jest.mock('@/theme', () => ({
  brand: { tealLight: '#0D9488' },
}));

const lastCall = () => {
  const calls = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
};

async function onPlatform(os: string, run: () => Promise<void>) {
  const original = Platform.OS;
  (Platform as { OS: string }).OS = os;
  try {
    await run();
  } finally {
    (Platform as { OS: string }).OS = original;
  }
}

describe('updateSyncNotification', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts notification with fixed identifier for in-place updates', async () => {
    await updateSyncNotification('Downloading GPS data... 5/20');

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'sync-progress' })
    );
  });

  it('sets sticky: true so Android users cannot swipe away', async () => {
    await updateSyncNotification('Downloading...');

    expect(lastCall().content.sticky).toBe(true);
  });

  it('names veloq-sync in the trigger, which is where Android reads it', async () => {
    await onPlatform('android', () => updateSyncNotification('Downloading...'));

    expect(lastCall().trigger).toEqual({ channelId: 'veloq-sync' });
  });

  it('leaves the trigger null on iOS, which has no channels', async () => {
    await onPlatform('ios', () => updateSyncNotification('Downloading...'));

    expect(lastCall().trigger).toBeNull();
    expect(lastCall().content.channelId).toBeUndefined();
  });

  it('re-posting keeps naming the channel, so no update falls back', async () => {
    await onPlatform('android', async () => {
      await updateSyncNotification('1/20');
      await updateSyncNotification('2/20');
      await updateSyncNotification('3/20');
    });

    const calls = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [request] of calls) {
      expect(request.trigger).toEqual({ channelId: 'veloq-sync' });
    }
  });
});

describe('the insight notifications name their own channel too', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends an insight on veloq-insights', async () => {
    await onPlatform('android', () => presentInsightNotification('PR', 'A new best'));

    expect(lastCall().trigger).toEqual({ channelId: 'veloq-insights' });
  });

  it('sends an activity notification on veloq-insights', async () => {
    await onPlatform('android', () => presentActivityNotification('a1', 'Ride', 'Done'));

    expect(lastCall().trigger).toEqual({ channelId: 'veloq-insights' });
  });

  it('leaves both triggers null on iOS', async () => {
    await onPlatform('ios', async () => {
      await presentInsightNotification('PR', 'A new best');
      await presentActivityNotification('a1', 'Ride', 'Done');
    });

    const calls = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls;
    for (const [request] of calls) expect(request.trigger).toBeNull();
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
        expect(result.shouldPlaySound).toBe(false);
        expect(result.shouldShowAlert).toBeUndefined();
      });
  });
});

// ============================================================
// NOTIFICATION TAP HANDLER (setupNotificationResponseHandler)
// ============================================================

describe('notification tap handler', () => {
  let { router } = require('expo-router') as {
    router: { push: jest.Mock; navigate: jest.Mock };
  };
  const {
    setupNotificationResponseHandler,
  } = require('@/features/settings/lib/notificationService');
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
          identifier: 'tap-test-activity',
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
          identifier: 'tap-test-section',
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
          identifier: 'tap-test-route',
          content: {
            data: { route: '/fitness' },
          },
        },
      },
    };

    callback(response);
    expect(router.navigate).toHaveBeenCalledWith('/fitness');
  });

  it('gracefully handles missing data in notification response', () => {
    setupNotificationResponseHandler();

    const callback = addListenerMock.mock.calls[0][0];
    const response = {
      notification: {
        request: {
          identifier: 'tap-test-missing-data',
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

  it('registers exactly one response listener per call', () => {
    setupNotificationResponseHandler();
    expect(addListenerMock).toHaveBeenCalledTimes(1);
  });
});
