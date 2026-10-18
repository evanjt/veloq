/**
 * Scenario: a map opens on a device with no radio and a cold WebView HTTP
 * cache. Every map in the app is a WebView, all three page builders share one
 * head, and up to five pages are alive at once, each holding its HTML string.
 *
 * Expected behaviour: the renderer ships in the app and is answered by the
 * platform interceptor on the page's own origin, so no page reaches the network
 * before it can draw, no page string carries a megabyte of renderer, and the
 * pinned version only moves in a commit.
 */

import {
  MAPLIBRE_GL_CSS_FILE,
  MAPLIBRE_GL_JS_FILE,
  MAPLIBRE_GL_VERSION,
} from '@/features/maps/assets/maplibreRenderer.generated';
import {
  buildMap3DHtml,
  buildMapSurfaceHtml,
  buildSnapshotWorkerHtml,
  mapLibreHead,
} from '@/features/maps/lib/htmlBuilders';
import { mapPageBaseUrl } from '@/features/maps/lib/tileTransport';

const pages: [string, string][] = [
  [
    'map surface',
    buildMapSurfaceHtml({
      style: 'light',
      camera: { center: [0, 0], zoom: 10 },
      interaction: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  ],
  ['3D map', buildMap3DHtml({ initStyle: 'dark', mapStyle: 'dark' } as never)],
  ['snapshot worker', buildSnapshotWorkerHtml(0)],
];

const rendererUrl = `${mapPageBaseUrl()}veloq-asset/${MAPLIBRE_GL_JS_FILE}`;
const stylesheetUrl = `${mapPageBaseUrl()}veloq-asset/${MAPLIBRE_GL_CSS_FILE}`;

describe('the bundled renderer', () => {
  it('is pinned, so a bump is a deliberate commit', () => {
    expect(MAPLIBRE_GL_VERSION).toBe('5.19.0');
  });

  it('is named by its version, so an immutable answer never outlives a bump', () => {
    expect(MAPLIBRE_GL_JS_FILE).toBe(`renderer/maplibre-gl-${MAPLIBRE_GL_VERSION}.js`);
    expect(MAPLIBRE_GL_CSS_FILE).toBe(`renderer/maplibre-gl-${MAPLIBRE_GL_VERSION}.css`);
  });
});

describe.each(pages)('%s', (_name, html) => {
  it('carries no copy of the renderer in the page string', () => {
    expect(html.length).toBeLessThan(150_000);
    expect(html).not.toContain('@license');
    expect(html).not.toContain('.maplibregl-map');
  });

  it('reaches no CDN for the renderer', () => {
    expect(html).not.toContain('unpkg.com');
    const sources = [...html.matchAll(/<script[^>]+\bsrc="([^"]+)"/gi)].map((m) => m[1]);
    expect(sources).toEqual([rendererUrl]);
    const links = [...html.matchAll(/<link[^>]+\bhref="([^"]+)"/gi)].map((m) => m[1]);
    expect(links).toEqual([stylesheetUrl]);
  });

  it('asks the page origin for the renderer and its stylesheet', () => {
    expect(html).toContain(`<script id="maplibre-gl" src="${rendererUrl}"></script>`);
    expect(html).toContain(`<link rel="stylesheet" href="${stylesheetUrl}">`);
  });

  it('loads the renderer before the first line that touches it', () => {
    expect(html.indexOf(rendererUrl)).toBeLessThan(html.indexOf('maplibregl.'));
  });

  it('loads the renderer as a blocking classic script, so the page scripts after it can use it', () => {
    const tag = /<script[^>]+\bsrc="[^"]+"[^>]*>/.exec(html)![0];
    expect(tag).not.toMatch(/\b(async|defer|type="module")\b/);
  });
});

describe('mapLibreHead', () => {
  it('is the one place the renderer is named', () => {
    expect(mapLibreHead()).toContain(rendererUrl);
    for (const [, html] of pages) {
      expect(html.split(rendererUrl).length - 1).toBe(1);
    }
  });
});
