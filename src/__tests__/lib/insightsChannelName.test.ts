/**
 * Scenario: Android lists the insights channel by name in the system's
 * notification settings, and the app created it with an English name whatever
 * language the athlete reads. The channel is created on mount, before the
 * launch has loaded any locale bundle.
 *
 * Expected behaviour: the channel is named in the app's language once the
 * bundles load, renamed when the language changes, and never named with an
 * unresolved key.
 */

import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { changeLanguage, i18n, initialiseI18n } from '@/i18n';
import { initialiseNotifications } from '@/features/settings/lib/notificationService';

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  deleteNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2 },
}));

jest.mock('@/features/insights', () => jest.requireActual('@/features/insights/lib/pushPayload'));
jest.mock('@/theme', () => ({
  nativeColours: { notificationAccent: '#2F6699' },
}));

const channelNames = () =>
  (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls.map(
    ([, channel]) => channel.name
  );

const originalOS = Platform.OS;
beforeAll(() => {
  (Platform as { OS: string }).OS = 'android';
});
afterAll(() => {
  (Platform as { OS: string }).OS = originalOS;
});

describe('the insights channel name', () => {
  it('waits for the bundles, names the channel in their language, and follows a change', async () => {
    expect(i18n.isInitialized).toBeFalsy();
    initialiseNotifications();
    expect(channelNames()).toEqual([]);

    await initialiseI18n('de-DE');
    expect(channelNames().at(-1)).toBe(i18n.t('notifications.channel.insightsName'));
    expect(channelNames().at(-1)).not.toBe('Activity Insights');

    await changeLanguage('fr');
    expect(channelNames().at(-1)).toBe(i18n.t('notifications.channel.insightsName'));
    expect(channelNames().at(-1)).not.toBe(
      i18n.getFixedT('de-DE')('notifications.channel.insightsName')
    );

    for (const name of channelNames()) expect(name).not.toMatch(/^notifications\./);
  });

  it('describes the channel in the same language', () => {
    const [, channel] = (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls.at(-1);
    expect(channel.description).toBe(i18n.t('notifications.channel.insightsDescription'));
  });
});

/**
 * Scenario: a new PR or fitness milestone is informational, and a channel at
 * IMPORTANCE_HIGH turns each one into a heads-up banner over whatever app is
 * open. Android keeps a channel's importance once it exists, so a quieter
 * channel needs a new id, and the old one is deleted so it does not linger in
 * the system's notification settings.
 */
describe('the activity channel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is created at default importance under a new id, with no vibration of its own', async () => {
    await changeLanguage('en-GB');

    const calls = (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls;
    expect(calls.map(([id]) => id)).toEqual(['veloq-activity']);
    const [, channel] = calls[0];
    expect(channel.importance).toBe(AndroidImportance.DEFAULT);
    expect(channel.vibrationPattern).toBeUndefined();
  });

  it('deletes the high-importance channel it replaces at launch', () => {
    initialiseNotifications();

    expect(Notifications.deleteNotificationChannelAsync).toHaveBeenCalledWith('veloq-insights');
  });

  it('touches no channel on iOS', () => {
    (Platform as { OS: string }).OS = 'ios';
    try {
      initialiseNotifications();
    } finally {
      (Platform as { OS: string }).OS = 'android';
    }

    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(Notifications.deleteNotificationChannelAsync).not.toHaveBeenCalled();
  });
});
