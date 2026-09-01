/**
 * Scenario: a map opens on a device with no radio and a cold WebView HTTP
 * cache. Every map in the app is a WebView, and all three page builders share
 * one head.
 *
 * Expected behaviour: the renderer ships in the app, so no page reaches the
 * network before it can draw, and the pinned version only moves in a commit.
 */

import {
  MAPLIBRE_GL_CSS,
  MAPLIBRE_GL_JS,
  MAPLIBRE_GL_VERSION,
} from '@/features/maps/assets/maplibreRenderer.generated';
import {
  buildMap3DHtml,
  buildMapSurfaceHtml,
  buildSnapshotWorkerHtml,
  mapLibreHead,
} from '@/features/maps/lib/htmlBuilders';

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
  ['3D map', buildMap3DHtml({ initialStyle: 'dark' } as never)],
  ['snapshot worker', buildSnapshotWorkerHtml(0)],
];

describe('the bundled renderer', () => {
  it('is pinned, so a bump is a deliberate commit', () => {
    expect(MAPLIBRE_GL_VERSION).toBe('5.19.0');
    expect(MAPLIBRE_GL_JS).toContain('MapLibre GL JS');
    expect(MAPLIBRE_GL_JS.length).toBeGreaterThan(500_000);
    expect(MAPLIBRE_GL_CSS).toContain('.maplibregl-map');
  });

  it('carries no tag-closing sequence, which would end the script it inlines into', () => {
    expect(MAPLIBRE_GL_JS).not.toMatch(/<\/script/i);
  });
});

describe.each(pages)('%s', (_name, html) => {
  it('reaches no CDN for the renderer', () => {
    expect(html).not.toContain('unpkg.com');
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
    expect(html).not.toMatch(/<link[^>]+\bhref="https?:/i);
  });

  it('inlines the renderer and its stylesheet', () => {
    expect(html.includes(MAPLIBRE_GL_JS)).toBe(true);
    expect(html.includes(MAPLIBRE_GL_CSS)).toBe(true);
  });

  it('defines the renderer before the first line that touches it', () => {
    expect(html.indexOf(MAPLIBRE_GL_JS)).toBeLessThan(html.indexOf('maplibregl.'));
  });
});

describe('mapLibreHead', () => {
  it('is the one place the renderer is inlined', () => {
    expect(mapLibreHead().includes(MAPLIBRE_GL_JS)).toBe(true);
    for (const [, html] of pages) {
      expect(html.split(MAPLIBRE_GL_JS).length - 1).toBe(1);
    }
  });
});
