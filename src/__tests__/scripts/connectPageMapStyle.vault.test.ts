/**
 * Scenario: the connect page draws the same basemaps as the phone, in a
 * browser, so it takes the styles the phone resolves, left on their upstream
 * host.
 *
 * Expected behaviour: both styles name their sources, sprite and glyphs on the
 * basemap host and nowhere else, with no tile-store, loopback or bundle URL; the
 * dark style paints the dark palette's water; the page's style is what the
 * phone's resolver answers when asked for no rewriting; and the corner line is
 * the phone's attribution for the base.
 */

import { MAP_ATTRIBUTIONS } from '@/features/maps/components/mapStyles';
import { resolveStyleForWebView } from '@/features/maps/lib/htmlBuilders/styleResolution';
import { mapPalette } from '@/theme/palette';

import {
  baseForScheme,
  otherBase,
  pageAttribution,
  pageStyle,
  type PageBase,
} from '../../../web/connect/map/style';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ setSourceTemplate: jest.fn() }),
  })
);

const BASEMAP_HOST = 'tiles.openfreemap.org';
const BASES: PageBase[] = ['light', 'dark'];

/** Every string in the style that is a URL or names a platform scheme. */
function links(style: object): string[] {
  return [
    ...JSON.stringify(style).matchAll(/"((?:https?|veloq[a-z-]*):[^"]*|[^"]*127\.0\.0\.1[^"]*)"/g),
  ].map((match) => match[1] as string);
}

describe('the connect page basemap styles', () => {
  it.each(BASES)(
    "names the %s style's sources, sprite and glyphs on the basemap host only",
    (base) => {
      const found = links(pageStyle(base));
      expect(found.length).toBeGreaterThan(0);
      for (const link of found) {
        expect(link).toMatch(/^https:\/\//);
        expect(new URL(link.replace(/\{[^}]*\}/g, '0')).host).toBe(BASEMAP_HOST);
      }
      const style = pageStyle(base) as { glyphs?: string; sprite?: string };
      expect(style.glyphs).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
      if (base === 'light') expect(style.sprite).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
    }
  );

  it.each(BASES)('carries no tile-store, loopback or bundled-asset URL in the %s style', (base) => {
    const text = JSON.stringify(pageStyle(base));
    expect(text).not.toContain('veloq-tile');
    expect(text).not.toContain('veloq-asset');
    expect(text).not.toContain('127.0.0.1');
  });

  it("paints the dark style's water in the dark palette's water", () => {
    const layers = (
      pageStyle('dark') as { layers: { id: string; paint?: Record<string, unknown> }[] }
    ).layers;
    expect(layers.find((layer) => layer.id === 'water')?.paint?.['fill-color']).toBe(
      mapPalette('dark').water
    );
  });

  it.each(BASES)(
    'is what the phone resolves for the %s base when asked for no rewriting',
    (base) => {
      const resolved = resolveStyleForWebView(base, {
        cacheVectorTiles: false,
        bundledAssets: false,
      });
      expect(pageStyle(base)).toEqual(resolved.inline);
    }
  );

  it.each(BASES)('credits the %s base as the phone does', (base) => {
    expect(pageAttribution()).toBe(MAP_ATTRIBUTIONS[base]);
  });

  it('follows the colour scheme, and the toggle goes to the other base', () => {
    expect(baseForScheme(true)).toBe('dark');
    expect(baseForScheme(false)).toBe('light');
    expect(otherBase('light')).toBe('dark');
    expect(otherBase('dark')).toBe('light');
  });
});
