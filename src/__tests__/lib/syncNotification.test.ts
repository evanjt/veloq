/**
 * Scenario: expo-notifications reads the Android channel from the trigger and
 * nowhere else. A channel named in `content` with `trigger: null` is dropped,
 * and the notification lands on expo's own fallback channel, which is
 * hardcoded IMPORTANCE_HIGH, so a notification that means to be quiet has to
 * name its channel in the trigger.
 *
 * Expected behaviour: the channel travels in the trigger, so it is the shape
 * the library consumes rather than the shape the code happened to produce.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  initializeNotifications,
  presentActivityNotification,
} from '@/features/settings/lib/notificationService';

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('sync-progress'),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2 },
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
}));

jest.mock('@/features/insights', () => jest.requireActual('@/features/insights/lib/pushPayload'));
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

describe('the activity notification names its own channel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends an activity notification on veloq-insights', async () => {
    await onPlatform('android', () => presentActivityNotification('a1', 'Ride', 'Done'));

    expect(lastCall().trigger).toEqual({ channelId: 'veloq-insights' });
  });

  it('leaves the trigger null on iOS', async () => {
    await onPlatform('ios', () => presentActivityNotification('a1', 'Ride', 'Done'));

    const calls = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls;
    for (const [request] of calls) expect(request.trigger).toBeNull();
  });
});

describe('notification handler differentiation', () => {
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
  const { useAuthStore } = require('@/shared/app/AuthStore');
  let addListenerMock: jest.Mock;

  /** A tap routes once the credential is read, and only for the athlete it names. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    router = require('expo-router').router;
    addListenerMock = Notifications.addNotificationResponseReceivedListener as jest.Mock;
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true, isLoading: false });
  });

  it('navigates to activity on tap with activityId', async () => {
    setupNotificationResponseHandler();

    const callback = addListenerMock.mock.calls[0][0];
    const response = {
      notification: {
        request: {
          identifier: 'tap-test-activity',
          content: {
            data: { activityId: 'act-123', route: '/routes', athleteId: 'i1' },
          },
        },
      },
    };

    callback(response);
    await settle();
    expect(router.push).toHaveBeenCalledWith('/activity/act-123');
  });

  it('navigates to section when sectionId provided without activityId', async () => {
    setupNotificationResponseHandler();

    const callback = addListenerMock.mock.calls[0][0];
    const response = {
      notification: {
        request: {
          identifier: 'tap-test-section',
          content: {
            data: { sectionId: 'sec-456', route: '/routes', athleteId: 'i1' },
          },
        },
      },
    };

    callback(response);
    await settle();
    expect(router.push).toHaveBeenCalledWith('/section/sec-456');
  });

  it('falls back to route when no activityId or sectionId', async () => {
    setupNotificationResponseHandler();

    const callback = addListenerMock.mock.calls[0][0];
    const response = {
      notification: {
        request: {
          identifier: 'tap-test-route',
          content: {
            data: { route: '/fitness', athleteId: 'i1' },
          },
        },
      },
    };

    callback(response);
    await settle();
    expect(router.navigate).toHaveBeenCalledWith('/fitness');
  });

  it('gracefully handles missing data in notification response', async () => {
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
    await settle();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('registers exactly one response listener per call', () => {
    setupNotificationResponseHandler();
    expect(addListenerMock).toHaveBeenCalledTimes(1);
  });
});
