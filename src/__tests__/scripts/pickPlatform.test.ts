/**
 * Scenario: the website opens its gallery on the visitor's own platform.
 * iPadOS in desktop mode reports a Mac user agent, told from a Mac only by
 * its touch points.
 */

import * as path from 'path';

const { pickPlatform } = require(path.resolve(__dirname, '../../../docs/platform.js')) as {
  pickPlatform: (userAgent: string, maxTouchPoints: number) => string;
};

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('pickPlatform', () => {
  it.each([
    ['an iPhone', IPHONE, 5, 'ios'],
    ['an iPad', IPAD, 5, 'ipad'],
    ['iPadOS in desktop mode', MAC, 5, 'ipad'],
    ['a Mac with no touch screen', MAC, 0, 'android'],
    ['a Mac reporting one touch point', MAC, 1, 'android'],
    ['an Android phone', ANDROID, 5, 'android'],
    ['a desktop browser', WINDOWS, 0, 'android'],
    ['an empty user agent', '', 0, 'android'],
  ])('%s', (_name, ua, touch, expected) => {
    expect(pickPlatform(ua as string, touch as number)).toBe(expected);
  });
});
