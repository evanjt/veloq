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

const { slideIndexForStem, stemOf } = require(
  path.resolve(__dirname, '../../../docs/platform.js')
) as {
  slideIndexForStem: (stems: string[], stem: string | null, fallback: number) => number;
  stemOf: (src: string) => string;
};

describe('stemOf', () => {
  it.each([
    ['a light shot', 'screenshots/android/05-insights.png', '05-insights'],
    ['a dark shot', 'screenshots/ipad/dark/05-insights.png', '05-insights'],
    ['a bare file name', '01-feed.png', '01-feed'],
  ])('%s', (_name, src, expected) => {
    expect(stemOf(src)).toBe(expected);
  });
});

describe('slideIndexForStem', () => {
  const phone = ['01-feed', '02-map', '03-activity', '04-section', '05-insights', '06-fitness'];
  const tablet = ['03-activity', '05-insights', '01-feed'];

  it('keeps the shot when the target set orders its stems differently', () => {
    expect(slideIndexForStem(tablet, '05-insights', 4)).toBe(1);
  });

  it('keeps the shot when switching to a set with the same stems', () => {
    expect(slideIndexForStem(phone, '05-insights', 0)).toBe(4);
  });

  it('falls back to the clamped position when the target set lacks the stem', () => {
    expect(slideIndexForStem(['01-feed', '02-map', '03-activity'], '06-fitness', 5)).toBe(2);
  });

  it('opens on the first shot when there is no stem and no position', () => {
    expect(slideIndexForStem(phone, null, 0)).toBe(0);
  });

  it('returns 0 for an empty set', () => {
    expect(slideIndexForStem([], '01-feed', 3)).toBe(0);
  });
});
