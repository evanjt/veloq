/**
 * Scenario: the athlete taps a new-activity push. The routing data is on the
 * wire (`worker.ts` puts `activityId` and `route` on the visible push), but the
 * shape it arrives in varies by platform: iOS wraps it as a JSON string under
 * `dataString`, Android FCM data messages arrive under `body`, and some paths
 * deliver it flat or nested.
 *
 * Expected behaviour: the tap path reads all four, the same normalisation the
 * background task already uses, so a wrapped payload is not a dead tap
 *. Both entry points feed one function, so the cold-start and live
 * paths cannot disagree.
 *
 * A tray entry can outlive the library it came from: a wipe dismisses the
 * tray, but a dismissal can fail, and a push for the previous athlete can still
 * arrive before their token is unregistered. Every entry names its athlete,
 * the server's in `athlete_id` and the app's own stamped when it is presented,
 * and a tap routes only for the athlete signed in now.
 */

import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { tapTargetFromPushData } from '@/features/insights/lib/pushPayload';
import { useAuthStore } from '@/shared/app/AuthStore';
import {
  presentActivityNotification,
  routeFromNotificationData,
  setupNotificationResponseHandler,
  handleInitialNotificationResponse,
  __resetHandledResponseIds,
} from '@/features/settings/lib/notificationService';

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3, LOW: 2 },
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  getLastNotificationResponseAsync: jest.fn(),
}));

jest.mock('@/features/insights', () => jest.requireActual('@/features/insights/lib/pushPayload'));
jest.mock('@/theme', () => ({
  brand: { tealLight: '#0D9488' },
}));

const ATHLETE = 'i12345';

const TAP = {
  activityId: 'i999',
  route: '/activity/i999',
  event_type: 'activity',
  activity_id: 'i999',
  athlete_id: ATHLETE,
};

function signIn(athleteId: string | null) {
  useAuthStore.setState({ athleteId, isAuthenticated: athleteId !== null, isLoading: false });
}

/** The data the tray holds for a notification this build presents. */
async function presented(present: () => Promise<void>): Promise<unknown> {
  const calls = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls;
  await present();
  return calls[calls.length - 1][0].content.data;
}

/** The same payload as each platform delivers it. */
const SHAPES: [string, Record<string, unknown>][] = [
  ['flat', { ...TAP }],
  ['dataString', { dataString: JSON.stringify(TAP) }],
  ['body', { body: JSON.stringify(TAP) }],
  ['nested', { data: { ...TAP } }],
];

describe('tapTargetFromPushData', () => {
  it.each(SHAPES)('routes the %s shape to the activity detail', (_name, data) => {
    expect(tapTargetFromPushData(data)).toEqual({ path: '/activity/i999', mode: 'push' });
  });

  it('routes a section payload to the section', () => {
    expect(tapTargetFromPushData({ sectionId: 'sec_1' })).toEqual({
      path: '/section/sec_1',
      mode: 'push',
    });
  });

  /// A bare route navigates rather than pushes, so a route that targets a
  /// mounted tab switches to it instead of stacking a duplicate.
  it('navigates for a payload that carries only a route', () => {
    expect(tapTargetFromPushData({ route: '/insights' })).toEqual({
      path: '/insights',
      mode: 'navigate',
    });
  });

  it('finds a wrapped route with no id', () => {
    expect(tapTargetFromPushData({ dataString: JSON.stringify({ route: '/insights' }) })).toEqual({
      path: '/insights',
      mode: 'navigate',
    });
  });

  it('reads the worker snake_case id as well as the tap camelCase one', () => {
    expect(tapTargetFromPushData({ activity_id: 'i7' })).toEqual({
      path: '/activity/i7',
      mode: 'push',
    });
  });

  it.each([
    ['nothing at all', undefined],
    ['an empty object', {}],
    ['a string', 'not a payload'],
    ['unparseable JSON', { dataString: '{' }],
    ['a payload with no routing fields', { title: 'hello' }],
  ])('goes nowhere for %s', (_name, data) => {
    expect(tapTargetFromPushData(data)).toBeNull();
  });
});

describe('routeFromNotificationData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signIn(ATHLETE);
  });

  it('opens an insight card through every notification payload shape', () => {
    const route = `/insights?tab=insights&insightId=${encodeURIComponent('hrv_trend-a&b')}`;
    const data = { route, insightId: 'hrv_trend-a&b', athleteId: ATHLETE };
    const shapes = [
      data,
      { dataString: JSON.stringify(data) },
      { body: JSON.stringify(data) },
      { data },
    ];

    for (const shape of shapes) {
      routeFromNotificationData(shape);
    }

    expect(router.navigate).toHaveBeenCalledTimes(shapes.length);
    expect(router.navigate).toHaveBeenCalledWith(route);
  });

  it('keeps section records linked to their section', () => {
    routeFromNotificationData({ route: '/insights', sectionId: 'sec_1', athleteId: ATHLETE });
    expect(router.push).toHaveBeenCalledWith('/section/sec_1');
  });

  it("opens the app's own activity entry for the athlete it was presented to", async () => {
    const data = await presented(() =>
      presentActivityNotification('i999', 'Morning Ride', 'A section PR', {
        route: '/activity/i999',
        activityId: 'i999',
      })
    );

    routeFromNotificationData(data);

    expect(router.push).toHaveBeenCalledWith('/activity/i999');
  });

  it('opens nothing from an entry presented to the athlete before a wipe', async () => {
    const activity = await presented(() =>
      presentActivityNotification('i999', 'Morning Ride', 'A section PR', {
        route: '/activity/i999',
        activityId: 'i999',
      })
    );
    const insight = { route: '/insights', sectionId: 's1', athleteId: ATHLETE };
    signIn('i777');

    for (const data of [activity, insight]) {
      routeFromNotificationData(data);
      routeFromNotificationData(data, true);
    }

    expect(router.push).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each(SHAPES)("opens nothing from another athlete's %s push", (_name, data) => {
    signIn('i777');
    routeFromNotificationData(data);
    routeFromNotificationData(data, true);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('opens nothing while signed out', () => {
    signIn(null);
    routeFromNotificationData({ ...TAP });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens nothing from an entry that names no athlete', () => {
    const { athlete_id: _athlete, ...unnamed } = TAP;
    routeFromNotificationData(unnamed);
    routeFromNotificationData({ route: '/insights' });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('opens nothing while signed out from an entry that names no athlete', () => {
    signIn(null);
    const { athlete_id: _athlete, ...unnamed } = TAP;
    routeFromNotificationData(unnamed);
    routeFromNotificationData(unnamed, true);
    routeFromNotificationData({ route: '/insights' });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each(SHAPES)('navigates on the %s shape', (_name, data) => {
    routeFromNotificationData(data);
    expect(router.push).toHaveBeenCalledWith('/activity/i999');
  });

  it('leaves a warm tap on the stack it already has', () => {
    routeFromNotificationData({ ...TAP });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('seats the feed under a cold-start tap, so back does not leave the app', () => {
    routeFromNotificationData({ ...TAP }, true);
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
    expect(router.push).toHaveBeenCalledWith('/activity/i999');
  });

  it('does not throw or navigate on a payload it cannot read', () => {
    expect(() => routeFromNotificationData({ title: 'hello' })).not.toThrow();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('the two tap entry points', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetHandledResponseIds();
    signIn(ATHLETE);
  });

  const response = (identifier: string, data: unknown) => ({
    notification: { request: { identifier, content: { data } } },
  });

  it('agree on a wrapped payload, whichever one sees it first', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(
      response('n1', { dataString: JSON.stringify(TAP) })
    );
    await handleInitialNotificationResponse();

    expect(router.push).toHaveBeenCalledWith('/activity/i999');
  });

  it('routes once when the same tap reaches both paths', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(
      response('n1', { dataString: JSON.stringify(TAP) })
    );
    await handleInitialNotificationResponse();

    setupNotificationResponseHandler();
    const listener = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock
      .calls[0][0];
    listener(response('n1', { dataString: JSON.stringify(TAP) }));

    expect(router.push).toHaveBeenCalledTimes(1);
  });

  /** Lets the live listener's credential read settle before the assertion. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('routes a live tap once the credential is read', async () => {
    setupNotificationResponseHandler();
    const listener = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock
      .calls[0][0];
    listener(response('n3', { body: JSON.stringify(TAP) }));
    await settle();

    expect(router.push).toHaveBeenCalledWith('/activity/i999');
  });

  /** A launch whose credential is still in the keychain, not yet in memory. */
  function credentialNotYetRead() {
    useAuthStore.setState({ athleteId: null, isAuthenticated: false, isLoading: true });
    const keychain: Record<string, string> = {
      intervals_athlete_id: ATHLETE,
      intervals_access_token: 'oauth-token',
    };
    jest
      .mocked(SecureStore.getItemAsync)
      .mockImplementation(async (key: string) => keychain[key] ?? null);
  }

  afterEach(() => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  });

  it('routes a cold tap that arrives before the credential is read', async () => {
    credentialNotYetRead();
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(
      response('n4', { dataString: JSON.stringify(TAP) })
    );

    await handleInitialNotificationResponse();

    expect(router.push).toHaveBeenCalledWith('/activity/i999');
  });

  it('routes a live tap that arrives before the credential is read', async () => {
    credentialNotYetRead();
    setupNotificationResponseHandler();
    const listener = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock
      .calls[0][0];

    listener(response('n5', { body: JSON.stringify(TAP) }));
    await useAuthStore.getState().initialize();
    await settle();

    expect(router.push).toHaveBeenCalledWith('/activity/i999');
  });

  it("route nowhere for another athlete's tap on either path", async () => {
    signIn('i777');
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(
      response('n1', { dataString: JSON.stringify(TAP) })
    );
    await handleInitialNotificationResponse();
    setupNotificationResponseHandler();
    const listener = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock
      .calls[0][0];
    listener(response('n2', { body: JSON.stringify(TAP) }));
    await settle();

    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
