/**
 * Scenario: the connect page draws the same basemaps as the phone, in a
 * browser, so it takes the styles the phone resolves, left on their upstream
 * host.
 *
 * Expected behaviour: both styles name their sources, sprite and glyphs on the
 * basemap host and nowhere else, with no tile-store, loopback or bundle URL; the
 * dark style paints the dark palette's water; the page's style is the
 * phone's upstream style before any rewriting; and the corner line is
 * the phone's attribution for the base. The satellite base draws the phone's global imagery and
 * 3D terrain the phone's elevation tiles, and every URL a style names on any base, with or without
 * terrain, is one the page's content security policy lets the page reach.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  MAP_ATTRIBUTIONS,
  SATELLITE_SOURCES,
  TERRAIN_3D_CONFIG,
} from '@/features/maps/components/mapStyles';
import { upstreamStyle } from '@/features/maps/lib/htmlBuilders/upstreamStyle';
import { mapPalette } from '@/theme/palette';

import {
  TERRAIN_EXAGGERATION,
  TERRAIN_PITCH,
  baseForScheme,
  otherBase,
  pageAttribution,
  pageStyle,
  toneOf,
  type PageBase,
} from '../../../web/connect/map/style';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ setSourceTemplate: jest.fn() }),
  })
);

const BASEMAP_HOST = 'tiles.openfreemap.org';
const BASES: ('light' | 'dark')[] = ['light', 'dark'];
const EVERY_BASE: PageBase[] = ['light', 'dark', 'satellite'];

/** The `connect-src` sources of the policy the page is deployed with. */
const CONNECT_SOURCES = (
  readFileSync(join(resolve(__dirname, '../../..'), 'web/connect/index.html'), 'utf8').match(
    /connect-src([^;"]*)/
  )?.[1] as string
)
  .trim()
  .split(/\s+/);

/** Whether a source of the policy lets the page fetch a URL: the same origin, and a path prefix when it names one. */
function permits(source: string, link: string): boolean {
  if (!/^https?:|^wss?:/.test(source)) return false;
  const allowed = new URL(source);
  const url = new URL(link);
  return (
    allowed.origin === url.origin &&
    (allowed.pathname === '/' || url.pathname.startsWith(allowed.pathname))
  );
}

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

  it.each(BASES)('is the upstream %s style the phone starts from, before any rewriting', (base) => {
    expect(pageStyle(base)).toEqual(upstreamStyle(base));
  });

  it.each(BASES)('credits the %s base as the phone does', (base) => {
    expect(pageAttribution()).toBe(MAP_ATTRIBUTIONS[base]);
  });

  it('follows the colour scheme, and the toggle goes to the other base', () => {
    expect(baseForScheme(true)).toBe('dark');
    expect(baseForScheme(false)).toBe('light');
    expect(otherBase('light')).toBe('dark');
    expect(otherBase('dark')).toBe('light');
  });

  it("draws the satellite base from the phone's global imagery and nothing else", () => {
    const style = pageStyle('satellite') as {
      sources: Record<string, { tiles: string[]; tileSize: number; maxzoom: number }>;
      layers: { id: string; type: string }[];
      terrain?: unknown;
    };
    const imagery = style.sources['satellite-global'];
    expect(Object.keys(style.sources)).toEqual(['satellite-global']);
    expect(imagery).toEqual({
      type: 'raster',
      tiles: SATELLITE_SOURCES.eox.tiles,
      tileSize: SATELLITE_SOURCES.eox.tileSize,
      maxzoom: SATELLITE_SOURCES.eox.maxzoom,
    });
    expect(style.layers.map((layer) => layer.type)).toEqual(['background', 'raster']);
    expect(style.terrain).toBeUndefined();
  });

  it.each(EVERY_BASE)(
    "adds the phone's elevation source, terrain and sky to the %s base",
    (base) => {
      const style = pageStyle(base, true) as {
        sources: Record<string, object>;
        terrain: { source: string; exaggeration: number };
        sky: Record<string, string>;
      };
      expect(style.sources.terrain).toEqual(TERRAIN_3D_CONFIG.source);
      expect(style.terrain).toEqual({ source: 'terrain', exaggeration: TERRAIN_EXAGGERATION });
      expect(TERRAIN_EXAGGERATION).toBe(TERRAIN_3D_CONFIG.defaultExaggeration);
      expect(TERRAIN_PITCH).toBe(TERRAIN_3D_CONFIG.defaultPitch);
      expect(style.sky['sky-color']).toBe(mapPalette(base).sky);
      expect(Object.keys(pageStyle(base, false))).not.toContain('terrain');
    }
  );

  it.each(EVERY_BASE)(
    'names only URLs the content security policy lets the page reach: %s',
    (base) => {
      for (const terrain of [false, true]) {
        const found = links(pageStyle(base, terrain));
        expect(found.length).toBeGreaterThan(0);
        for (const link of found) {
          const probe = link.replace(/\{[^}]*\}/g, '0');
          expect({
            link,
            reachable: CONNECT_SOURCES.some((source) => permits(source, probe)),
          }).toEqual({
            link,
            reachable: true,
          });
        }
      }
    }
  );

  it('gives satellite the dark tokens, as the phone does, and the light base the light', () => {
    expect(toneOf('satellite')).toBe('dark');
    expect(toneOf('dark')).toBe('dark');
    expect(toneOf('light')).toBe('light');
  });

  it('credits the satellite base and the elevation tiles as the phone does', () => {
    expect(pageAttribution('satellite')).toBe(MAP_ATTRIBUTIONS.satellite);
    expect(pageAttribution('light', true)).toContain(MAP_ATTRIBUTIONS.light);
    expect(pageAttribution('satellite', true)).toContain('Mapzen');
    expect(pageAttribution('satellite', true)).toContain(MAP_ATTRIBUTIONS.satellite);
  });
});
