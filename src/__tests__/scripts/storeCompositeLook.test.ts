/**
 * Scenario: the store composites and the feature graphic are where a stranger
 * first meets the app, so they carry the app's own type, logo and colours.
 *
 * Expected behaviour: every template sets its type in the app's bundled
 * Manrope, the feature graphic draws the outlined logo file, the caption is
 * sentence case with no rule, every colour is a token, the kicker is blue
 * except on an achievement shot, and the line layer is drawn from the demo
 * library's own tracks.
 */

import * as fs from 'fs';
import * as path from 'path';

import { demoRoutes } from '@/shared/demo/routes/routes';
import { colourTokens } from '@/theme/colourTokens.generated';

import { storePalette } from '../../../scripts/store-theme';
import {
  dims,
  featureHtml,
  makeCss,
  phoneHtml,
  type Caption,
} from '../../../scripts/store-templates';
import { trackLayer } from '../../../scripts/store-tracks';

const ROOT = path.resolve(__dirname, '../../..');
const APP_FONTS = path.join(ROOT, 'assets', 'fonts');
const LOGO = path.join(ROOT, 'src', 'assets', 'logos', 'logo.svg');

const fontUrls = (html: string) =>
  [...html.matchAll(/url\('file:\/\/([^']+)'\)/g)].map((m) => m[1]);
const imageSources = (html: string) =>
  [...html.matchAll(/<img[^>]*src="file:\/\/([^"]+)"/g)].map((m) => m[1]);

const caption: Caption = { kicker: 'Feed', cap: 'Your activity\nhistory', sub: 'Synced.' };
const phone = (c: Caption) => phoneHtml(storePalette, dims(1080, 1920, 'android'), c, '/x.png');

const tokenHexes = new Set(
  [
    ...Object.values(colourTokens.light),
    ...Object.values(colourTokens.dark),
    '#FFFFFF',
    '#000000',
  ].map((v) => v.toUpperCase())
);
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
const tokenRgb = new Set([...tokenHexes].map(channels));

describe('store composite look', () => {
  it('sets every face from the fonts the app bundles', () => {
    const urls = fontUrls(makeCss(storePalette));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(path.dirname(url)).toBe(APP_FONTS);
      expect(path.basename(url)).toMatch(/^Manrope-/);
      expect(fs.existsSync(url)).toBe(true);
    }
  });

  it('draws the logo file on the feature graphic instead of typesetting a wordmark', () => {
    const html = featureHtml(storePalette, 'A headline', 'A tagline', '/raw/01-feed.png');
    expect(imageSources(html)).toContain(LOGO);
    expect(html).not.toMatch(/class="wordmark"/);
  });

  it('keeps the phone composite on the same faces as the feature graphic', () => {
    expect(fontUrls(phone(caption))).toEqual(
      fontUrls(featureHtml(storePalette, 'A headline', 'A tagline', '/x.png'))
    );
  });

  it('carries no uppercase and no rule on any template', () => {
    for (const html of [
      phone(caption),
      featureHtml(storePalette, 'A headline', 'A tagline', '/x.png'),
    ]) {
      expect(html).not.toMatch(/uppercase/);
      expect(html).not.toMatch(/\.rule|class="rule"/);
    }
  });

  it('resolves every colour in the rendered CSS to a colour token', () => {
    for (const html of [
      phone(caption),
      featureHtml(storePalette, 'A headline', 'A tagline', '/x.png'),
    ]) {
      const hexes = html.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
      const rgbas = [...html.matchAll(/rgba\((\d+), (\d+), (\d+), [\d.]+\)/g)].map(
        (m) => `${m[1]},${m[2]},${m[3]}`
      );
      expect(hexes.length + rgbas.length).toBeGreaterThan(0);
      for (const hex of hexes) expect(tokenHexes).toContain(hex.toUpperCase());
      for (const rgb of rgbas) expect(tokenRgb).toContain(rgb);
    }
  });

  it('colours the kicker blue, and gold on an achievement shot', () => {
    const kicker = (html: string) => html.match(/<div class="kicker([^"]*)"/)?.[1] ?? null;
    const plainCss = makeCss(storePalette);
    expect(kicker(phone(caption))).toBe('');
    expect(kicker(phone({ ...caption, achievement: true }))).toBe(' gold');
    expect(plainCss).toContain(`.kicker { color: ${storePalette.kicker}`);
    expect(plainCss).toContain(`.kicker.gold { color: ${storePalette.kickerAchievement}`);
    expect(storePalette.kicker).toBe(colourTokens.light['blue-600']);
    expect(storePalette.kickerAchievement).toBe(colourTokens.light['gold-600']);
  });

  it('renders no kicker element for a caption without one', () => {
    expect(phone({ cap: 'A', sub: 'B' })).not.toMatch(/class="kicker/);
  });

  describe('track layer', () => {
    const layer = trackLayer(1080, 1920);

    it('draws only tracks of the demo library, every point projected from its own fixes', () => {
      expect(layer.lines.length).toBeGreaterThan(3);
      for (const line of layer.lines) {
        const route = demoRoutes.find((r) => r.id === line.routeId);
        expect(route).toBeDefined();
        expect(line.points.length).toBeGreaterThan(10);
        expect(line.points.length).toBeLessThanOrEqual(route!.coordinates.length);
        // North is up: the northernmost fix has the smallest y.
        const lats = route!.coordinates.map((c) => c[0]);
        const ys = line.points.map((p) => p[1]);
        const drawnNorth = ys.indexOf(Math.min(...ys)) / (ys.length - 1);
        const source = Math.round(drawnNorth * (lats.length - 1));
        const range = Math.max(...lats) - Math.min(...lats);
        expect(Math.max(...lats) - lats[source]!).toBeLessThan(range * 0.05);
      }
    });

    it('keeps every line inside the canvas and is deterministic', () => {
      for (const line of layer.lines) {
        for (const [x, y] of line.points) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1080);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1920);
        }
      }
      expect(trackLayer(1080, 1920)).toEqual(layer);
    });

    it('is drawn behind everything at the palette line colour', () => {
      const html = phone(caption);
      expect(html).toContain(`stroke="${storePalette.line}"`);
      expect(html.indexOf('<svg class="tracks"')).toBeLessThan(html.indexOf('class="canvas"'));
    });
  });
});
