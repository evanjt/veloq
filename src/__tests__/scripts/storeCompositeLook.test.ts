/**
 * Scenario: the store composites and the feature graphic are where a stranger
 * first meets the app, so they carry the app's own type and logo.
 *
 * Expected behaviour: every template sets its type in the app's bundled
 * Manrope, the feature graphic draws the outlined logo file rather than
 * typesetting a wordmark, and the palettes accent in the app's action blue.
 */

import * as fs from 'fs';
import * as path from 'path';

import { storePalettes } from '@/shared/theme/storeTheme';
import { colors, darkColors } from '@/theme/colors';

import { dims, featureHtml, makeCss, phoneHtml } from '../../../scripts/store-templates';

const ROOT = path.resolve(__dirname, '../../..');
const APP_FONTS = path.join(ROOT, 'assets', 'fonts');
const LOGO = path.join(ROOT, 'src', 'assets', 'logos', 'logo.svg');

const fontUrls = (html: string) =>
  [...html.matchAll(/url\('file:\/\/([^']+)'\)/g)].map((m) => m[1]);
const imageSources = (html: string) =>
  [...html.matchAll(/<img[^>]*src="file:\/\/([^"]+)"/g)].map((m) => m[1]);

describe('store composite look', () => {
  const night = storePalettes.night;

  it('sets every face from the fonts the app bundles', () => {
    const urls = fontUrls(makeCss(night));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(path.dirname(url)).toBe(APP_FONTS);
      expect(path.basename(url)).toMatch(/^Manrope-/);
      expect(fs.existsSync(url)).toBe(true);
    }
  });

  it('draws the logo file on the feature graphic instead of typesetting a wordmark', () => {
    const html = featureHtml(night, 'A tagline', '/raw/01-feed.png');
    expect(imageSources(html)).toContain(LOGO);
    expect(html).not.toMatch(/velo\s*<span/i);
    expect(html).not.toMatch(/class="wordmark"/);
  });

  it('keeps the phone composite on the same faces as the feature graphic', () => {
    const html = phoneHtml(night, dims(1080, false), '0%', '27%', { cap: 'A', sub: 'B' }, '/x.png');
    expect(fontUrls(html)).toEqual(fontUrls(featureHtml(night, 'A tagline', '/x.png')));
  });

  it('accents both palettes in the action blue of their own theme', () => {
    expect(storePalettes.night.mark).toBe(darkColors.actionPrimary);
    expect(storePalettes.day.mark).toBe(colors.actionPrimary);
  });
});
