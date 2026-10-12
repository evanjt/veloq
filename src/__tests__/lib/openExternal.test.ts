/**
 * Scenario: a web page that belongs to the task opens in the in-app browser,
 * and a store, mail or settings scheme goes to the operating system. A device
 * with no store app rejects the store scheme.
 *
 * Expected behaviour: http and https open in the in-app browser, every other
 * scheme goes to `Linking`, and a rejected store scheme opens the store's web
 * listing published in `app.json` rather than doing nothing.
 */

import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { openExternal } from '@/shared/app/openExternal';
import { openStorePage } from '@/shared/app/supportLinks';
import appConfig from '../../../app.json';

jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openBrowserAsync: jest.fn(),
}));
// A native build embeds the whole app config, `app.json` included.
jest.mock('expo-constants', () => ({
  ...jest.requireActual('expo-constants'),
  __esModule: true,
  default: { expoConfig: jest.requireActual('../../../app.json').expo },
}));

const PLAY_LISTING = appConfig.expo.android.playStoreUrl;
const APP_LISTING = appConfig.expo.ios.appStoreUrl;

const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;
let openURL: jest.SpyInstance;
const platform = Platform.OS;

beforeEach(() => {
  openBrowser.mockReset().mockResolvedValue({ type: 'dismiss' });
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  openURL.mockRestore();
  Platform.OS = platform;
});

describe('openExternal', () => {
  it('opens an https page in the in-app browser and never hands it to the OS', async () => {
    await openExternal('https://example.org/privacy');
    expect(openBrowser).toHaveBeenCalledWith('https://example.org/privacy');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('opens a plain http page in the in-app browser too', async () => {
    await openExternal('http://example.org');
    expect(openBrowser).toHaveBeenCalledWith('http://example.org');
  });

  it('hands a store, mail or settings scheme to the OS', async () => {
    for (const url of ['market://details?id=x', 'itms-apps://apps.example/id1', 'mailto:a@b.c']) {
      await openExternal(url);
      expect(openURL).toHaveBeenLastCalledWith(url);
    }
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('falls back to the system browser when the in-app browser fails', async () => {
    openBrowser.mockRejectedValueOnce(new Error('no browser'));
    await openExternal('https://example.org');
    expect(openURL).toHaveBeenCalledWith('https://example.org');
  });

  it('opens the fallback page when the OS refuses the scheme', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await openExternal('market://details?id=x', 'https://example.org/listing');
    expect(openBrowser).toHaveBeenCalledWith('https://example.org/listing');
  });

  it('settles quietly when the OS refuses a scheme with no fallback', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await expect(openExternal('mailto:a@b.c')).resolves.toBe(false);
    expect(openBrowser).not.toHaveBeenCalled();
  });
});

describe('openStorePage', () => {
  it('opens the web listing on Android when no store app takes market://', async () => {
    Platform.OS = 'android';
    openURL.mockRejectedValueOnce(new Error('no store'));
    await openStorePage({ review: true });
    expect(openURL.mock.calls[0][0]).toMatch(/^market:\/\//);
    expect(openBrowser).toHaveBeenCalledWith(PLAY_LISTING);
  });

  it('opens the web review form on iOS when no store app takes itms-apps://', async () => {
    Platform.OS = 'ios';
    openURL.mockRejectedValueOnce(new Error('no store'));
    await openStorePage({ review: true });
    expect(openURL.mock.calls[0][0]).toMatch(/^itms-apps:\/\//);
    expect(openBrowser).toHaveBeenCalledWith(`${APP_LISTING}?action=write-review`);
  });

  it('opens no web page when the store app takes the scheme', async () => {
    Platform.OS = 'android';
    await openStorePage();
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
