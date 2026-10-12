/**
 * Scenario: a phone with no store app (a de-Googled Android, an emulator image
 * without Play) rejects the store scheme, so the listing never opened and the
 * rejection went unhandled.
 *
 * Expected behaviour: a rejected store scheme falls back to the web listing in
 * the in-app browser, and the result says whether anything opened.
 */

import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { openStorePage } from '@/shared/app/supportLinks';

jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openBrowserAsync: jest.fn(),
}));

const openBrowserAsync = WebBrowser.openBrowserAsync as jest.Mock;
const originalOS = Platform.OS;
let openURL: jest.SpyInstance;

beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL');
  openBrowserAsync.mockReset();
});

afterEach(() => {
  openURL.mockRestore();
  Platform.OS = originalOS;
});

describe('openStorePage', () => {
  it('opens the Play listing through the store scheme when it resolves', async () => {
    Platform.OS = 'android';
    openURL.mockResolvedValue(true);

    await expect(openStorePage({ review: true })).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith('market://details?id=com.veloq.app');
    expect(openBrowserAsync).not.toHaveBeenCalled();
  });

  it('falls back to the web Play listing when the store scheme rejects', async () => {
    Platform.OS = 'android';
    openURL.mockRejectedValue(new Error('No Activity found to handle Intent'));
    openBrowserAsync.mockResolvedValue({ type: 'opened' });

    await expect(openStorePage({ review: true })).resolves.toBe(true);
    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://play.google.com/store/apps/details?id=com.veloq.app'
    );
  });

  it('falls back to the web App Store review form when the store scheme rejects', async () => {
    Platform.OS = 'ios';
    openURL.mockRejectedValue(new Error('Unable to open URL'));
    openBrowserAsync.mockResolvedValue({ type: 'opened' });

    await expect(openStorePage({ review: true })).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith(
      'itms-apps://apps.apple.com/app/id6757836732?action=write-review'
    );
    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://apps.apple.com/app/id6757836732?action=write-review'
    );
  });

  it('falls back to the web App Store listing without the review action', async () => {
    Platform.OS = 'ios';
    openURL.mockRejectedValue(new Error('Unable to open URL'));
    openBrowserAsync.mockResolvedValue({ type: 'opened' });

    await expect(openStorePage()).resolves.toBe(true);
    expect(openBrowserAsync).toHaveBeenCalledWith('https://apps.apple.com/app/id6757836732');
  });

  it('reports failure, without rejecting, when the browser cannot open either', async () => {
    Platform.OS = 'android';
    openURL.mockRejectedValue(new Error('No Activity found to handle Intent'));
    openBrowserAsync.mockRejectedValue(new Error('No browser'));

    await expect(openStorePage({ review: true })).resolves.toBe(false);
  });
});
