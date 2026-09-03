/**
 * Scenario: the athlete taps a new-activity push. The routing data is on the
 * wire (`worker.ts` puts `activityId` and `route` on the visible push), but the
 * shape it arrives in varies by platform: iOS wraps it as a JSON string under
 * `dataString`, Android FCM data messages arrive under `body`, and some paths
 * deliver it flat or nested.
 *
 * Expected behaviour: the tap path reads all four, the same normalisation the
 * background task already uses, so a wrapped payload is not a dead tap
 * (`B144`). Both entry points feed one function, so the cold-start and live
 * paths cannot disagree.
 */

import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { tapTargetFromPushData } from '@/features/insights/lib/pushPayload';
import {
  routeFromNotificationData,
  setupNotificationResponseHandler,
  handleInitialNotificationResponse,
  __resetHandledResponseIds,
} from '@/features/settings/lib/notificationService';

jest.mock('expo-notifications', () => ({
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

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
}));

jest.mock('@/theme', () => ({
  brand: { tealLight: '#0D9488' },
}));

const TAP = {
  activityId: 'i999',
  route: '/activity/i999',
  event_type: 'activity',
  activity_id: 'i999',
};

/** The same payload as each platform delivers it. */
const SHAPES: [string, Record<string, unknown>][] = [
  ['flat', { ...TAP }],
  ['dataString', { dataString: JSON.stringify(TAP) }],
  ['body', { body: JSON.stringify(TAP) }],
  ['nested', { data: { ...TAP } }],
];

describe('tapTargetFromPushData', () => {
  it.each(SHAPES)('routes the %s shape to the activity', (_name, data) => {
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
  beforeEach(() => jest.clearAllMocks());

  it.each(SHAPES)('navigates on the %s shape', (_name, data) => {
    routeFromNotificationData(data);
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
});
