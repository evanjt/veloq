/**
 * Scenario: Android lists the channel the recording service posts on in the
 * system's notification settings. The location library creates that channel
 * only when it is absent, named after the app with an English description.
 *
 * Expected behaviour: the channel is created in the app's language before the
 * service starts, renamed when the language changes, and never named with an
 * unresolved key.
 */

import { changeLanguage, i18n, initialiseI18n } from '@/i18n';
import { nameRecordingChannel } from '@/features/recording/lib/recordingNotification';

const mockNameChannel = jest.fn();

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: (name: string) =>
    name === 'VeloqRecordingNotification'
      ? { nameChannel: (...args: unknown[]) => mockNameChannel(...args) }
      : null,
}));

// Stopping a ride is not under test, and it reaches the router, which needs native modules.
jest.mock('@/features/recording/lib/endRecordingSession', () => ({
  endRecordingSession: jest.fn(),
}));

const channelNames = () => mockNameChannel.mock.calls.map(([name]) => name as string);

describe('the recording channel name', () => {
  it('waits for the bundles, names the channel in their language, and follows a change', async () => {
    expect(i18n.isInitialized).toBeFalsy();
    nameRecordingChannel();
    expect(channelNames()).toEqual([]);

    await initialiseI18n('de-DE');
    expect(channelNames().at(-1)).toBe(i18n.t('recording.serviceChannel.name'));
    expect(channelNames().at(-1)).not.toBe(
      i18n.getFixedT('en-GB')('recording.serviceChannel.name')
    );

    await changeLanguage('fr');
    expect(channelNames().at(-1)).toBe(i18n.t('recording.serviceChannel.name'));
    expect(channelNames().at(-1)).not.toBe(
      i18n.getFixedT('de-DE')('recording.serviceChannel.name')
    );

    for (const name of channelNames()) expect(name).not.toMatch(/^recording\./);
  });

  it('describes the channel in the same language', () => {
    const [, description] = mockNameChannel.mock.calls.at(-1);
    expect(description).toBe(i18n.t('recording.serviceChannel.description'));
    expect(description).not.toMatch(/^recording\./);
  });

  it('names the channel again on the next ride without a second listener', async () => {
    mockNameChannel.mockClear();
    nameRecordingChannel();
    expect(mockNameChannel).toHaveBeenCalledTimes(1);

    mockNameChannel.mockClear();
    await changeLanguage('it');
    expect(mockNameChannel).toHaveBeenCalledTimes(1);
  });
});
