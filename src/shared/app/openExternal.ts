/**
 * The one way out of the app to another page or app. A web page opens in the
 * in-app browser, so the athlete returns with its Done button and nothing they
 * were doing is lost. Every other scheme (store, mail, settings) belongs to the
 * operating system. A device with no handler for that scheme rejects it, and the
 * press then opens `fallback` if one is given, so a tap is never silent. It
 * resolves whether anything opened, and never rejects.
 */

import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { debug } from '@/shared/debug/debug';

const log = debug.create('OpenExternal');

const WEB_PAGE = /^https?:\/\//i;

export async function openExternal(url: string, fallback?: string): Promise<boolean> {
  if (WEB_PAGE.test(url)) {
    try {
      await WebBrowser.openBrowserAsync(url);
      return true;
    } catch (e) {
      log.warn('the in-app browser failed, handing the page to the system', e);
      return Linking.openURL(url).then(
        () => true,
        (err: unknown) => {
          log.warn('could not open', url, err);
          return false;
        }
      );
    }
  }
  try {
    await Linking.openURL(url);
    return true;
  } catch (e) {
    if (fallback) return openExternal(fallback);
    log.warn('no app takes', url, e);
    return false;
  }
}
