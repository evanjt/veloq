/**
 * Scenario: the renderer every map draws with is bundled into the app as a
 * pinned script, outside npm, so no advisory or dependency update reaches it,
 * and a bump that throws inside the page leaves every map blank with nothing
 * failing the build.
 *
 * Expected behaviour: each of the three pages, built as the app builds it,
 * draws in a real browser, takes terrain on and off, swaps its style and takes
 * terrain again on the new one, with no map error and no uncaught page error.
 * The 3D page, its map released, builds a new one in place that draws too.
 * A renderer whose `setTerrain` throws fails the same run. While the renderer
 * is below the release that sanitises attribution HTML safely, no page mounts
 * an attribution control.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { Platform } from 'react-native';

import { MAPLIBRE_GL_VERSION } from '@/features/maps/assets/maplibreRenderer.generated';
import {
  buildApplyScript,
  buildMap3DHtml,
  buildMap3DSetStyleScript,
  buildMapSurfaceHtml,
  buildRenderSnapshotScript,
  buildSetStyleScript,
  buildSnapshotWorkerHtml,
  resolveStyleForWebView,
} from '@/features/maps/lib/htmlBuilders';
import type {
  Map3DHtmlConfig,
  MapSurfaceSpec,
  SnapshotRequest,
} from '@/features/maps/lib/htmlBuilders';
import { buildMap3DBuildScript } from '@/features/maps/lib/htmlBuilders/map3D';
import { buildReleaseMapScript } from '@/features/maps/lib/htmlBuilders/shared';
import { terrain3DSource } from '@/features/maps/components/mapStyles';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { mapPageBaseUrl } from '@/features/maps/lib/tileTransport';
import { findChromium, launchChromium } from '../../__shared__/headlessMapPage';
import type { Chromium, MapPage } from '../../__shared__/headlessMapPage';

const PAGE_TIMEOUT_MS = 240_000;

/** The first release whose attribution control sanitises its HTML safely. */
const ATTRIBUTION_SAFE_FROM = '6.4.1';

const STYLES: MapStyleType[] = ['light', 'dark', 'satellite'];

const ROUTE: [number, number][] = [
  [7.65, 45.97],
  [7.66, 45.975],
  [7.67, 45.978],
  [7.68, 45.98],
];

function below(version: string, floor: string): boolean {
  const a = version.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** Every TileJSON url a page's styles name, so the stand-in network can answer it. */
function tileJsonUrls(): string[] {
  const urls = new Set<string>();
  for (const style of STYLES) {
    const resolved = resolveStyleForWebView(style);
    const sources = (resolved.inline as { sources?: Record<string, { url?: string }> }).sources;
    for (const source of Object.values(sources ?? {})) {
      if (typeof source.url === 'string') urls.add(source.url);
    }
  }
  return [...urls];
}

/**
 * In-page helpers: wait for a map to be built and loaded, and wait for it to
 * settle, which is `idle` after a repaint and so means every requested tile
 * has drawn.
 */
const HELPERS = `
  window.__waitForMap = function(timeoutMs) {
    return new Promise(function(resolve, reject) {
      var started = Date.now();
      (function poll() {
        if (window.map && window.map.loaded()) return resolve();
        if (Date.now() - started > timeoutMs) return reject(new Error('the map never loaded'));
        setTimeout(poll, 50);
      })();
    });
  };
  window.__settle = function(label) {
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() { reject(new Error(label + ': the map never settled')); }, 60000);
      window.map.once('idle', function() { clearTimeout(timer); resolve(); });
      window.map.triggerRepaint();
    });
  };
  // A frame drawn at once, as one may land between a swap and the new style
  // loading. Left to timing, a run passes or fails on whether one did.
  window.__frameNow = function() {
    if (window.map) window.map.redraw();
    return true;
  };
  window.__terrainOn = function(source, label) {
    if (!window.map.getSource('terrain')) window.map.addSource('terrain', source);
    window.map.setTerrain({ source: 'terrain', exaggeration: 1.5 });
    return window.__settle(label);
  };
  true;
`;

async function waitForPosted(
  page: MapPage,
  match: (message: Record<string, unknown>) => boolean,
  label: string
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const found = ((await page.posted()) as Record<string, unknown>[]).find(
      (message) => typeof message === 'object' && match(message)
    );
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label}: no reply from the page`);
}

/** Takes terrain on and off, then for each style swaps to it and takes terrain on it. */
async function driveInteractivePage(page: MapPage, swap: (style: MapStyleType) => string) {
  const dem = JSON.stringify(terrain3DSource());
  await page.evaluate('window.__waitForMap(30000)');
  await page.evaluate(`window.__settle('first draw')`);
  await page.evaluate(`window.__terrainOn(${dem}, 'terrain on')`);
  await page.evaluate(`window.map.setTerrain(null); window.__settle('terrain off')`);
  for (const style of STYLES) {
    await page.evaluate(`${swap(style)}; window.__frameNow()`);
    await page.evaluate(`window.__settle('swap to ${style}')`);
    await page.evaluate(`window.__terrainOn(${dem}, 'terrain on ${style}')`);
  }
}

const MAP_3D: Map3DHtmlConfig = {
  coordinates: ROUTE,
  bounds: { sw: [7.65, 45.97], ne: [7.68, 45.98] },
  centerOverride: null,
  zoom: 12,
  bearing: 30,
  pitch: 60,
  hasSavedCamera: false,
  terrainExaggeration: 1.5,
  initStyle: 'light',
  mapStyle: 'light',
  routeColor: '#e4572e',
  showHeatmap: false,
  devicePixelRatio: 1,
  reduceMotion: false,
};

interface PageUnderTest {
  name: string;
  html: () => string;
  drive: (page: MapPage) => Promise<void>;
}

const PAGES: PageUnderTest[] = [
  {
    name: 'map surface',
    html: () =>
      buildMapSurfaceHtml({
        style: 'light',
        camera: { center: [7.66, 45.976], zoom: 12 },
        interaction: { scroll: true, zoom: true, rotate: true, pitch: true },
        devicePixelRatio: 1,
        reduceMotion: false,
        regionChangeThrottleMs: 100,
      }),
    drive: (page) => driveInteractivePage(page, (style) => buildSetStyleScript(style)),
  },
  {
    name: '3D map',
    html: () => buildMap3DHtml(MAP_3D),
    drive: async (page) => {
      await driveInteractivePage(page, (style) =>
        buildMap3DSetStyleScript({
          mapStyle: style,
          routeColor: '#e4572e',
          terrainExaggeration: 1.5,
          heatmapGeneration: 0,
          showHeatmap: false,
        })
      );
      await page.evaluate(buildReleaseMapScript());
      await page.evaluate(
        buildMap3DBuildScript({
          ...MAP_3D,
          coordinates: ROUTE.slice(1),
          centerOverride: [7.67, 45.978],
          zoom: 13,
          hasSavedCamera: true,
          initStyle: 'dark',
          mapStyle: 'dark',
        })
      );
      await page.evaluate('window.__waitForMap(30000)');
      await page.evaluate(`window.__settle('rebuilt in place')`);
      const ready = ((await page.posted()) as Record<string, unknown>[]).filter(
        (message) => message?.type === 'mapReady'
      );
      if (ready.length !== 2) throw new Error(`rebuilt in place: ${ready.length} mapReady posted`);
    },
  },
  {
    name: 'snapshot worker',
    html: () => buildSnapshotWorkerHtml(0),
    drive: async (page) => {
      await page.evaluate('window.__waitForMap(30000)');
      let gen = 0;
      for (const mapStyle of STYLES) {
        for (const flat of [false, true]) {
          gen++;
          const request: SnapshotRequest = {
            activityId: `ride-${gen}`,
            coordinates: ROUTE,
            camera: { center: [7.665, 45.975], zoom: 12, bearing: 30, pitch: flat ? 0 : 60 },
            mapStyle,
            flat,
          };
          await page.evaluate(`${buildRenderSnapshotScript(request, 0, gen)}; window.__frameNow()`);
          const reply = await waitForPosted(
            page,
            (message) =>
              message.gen === gen &&
              (message.type === 'snapshot' || message.type === 'snapshotError'),
            `render ${gen}`
          );
          if (reply.type !== 'snapshot') {
            throw new Error(`render ${gen} (${mapStyle}, flat ${flat}): ${String(reply.error)}`);
          }
        }
      }
    },
  },
];

/** A ride drawn on the surface page, which every terrain change must leave in place. */
const RIDE_SPEC: MapSurfaceSpec = {
  sources: {
    ride: {
      kind: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: ROUTE },
      },
    },
  },
  layers: [
    {
      id: 'ride-line',
      type: 'line',
      source: 'ride',
      paint: { 'line-color': '#e4572e', 'line-width': 4 },
    },
  ],
  interactiveLayers: ['ride-line'],
};

const TILTED = { exaggeration: 1.5, pitch: 60 };

/** A surface page opened flat, as `MapSurface` opens it, pitch and rotate gestures off. */
const flatSurfaceHtml = () =>
  buildMapSurfaceHtml({
    style: 'light',
    camera: { center: [7.66, 45.976], zoom: 12 },
    interaction: { scroll: true, zoom: true, rotate: false, pitch: false },
    devicePixelRatio: 1,
    reduceMotion: false,
    regionChangeThrottleMs: 100,
  });

interface SurfaceTerrainState {
  terrain: boolean;
  hillshade: boolean;
  hillshadeBelowRide: boolean;
  ride: boolean;
  rideSource: boolean;
  pitch: number;
  touchPitch: boolean;
  dragRotate: boolean;
}

const SURFACE_STATE = `(function() {
  var map = window.map;
  var ids = map.getStyle().layers.map(function(layer) { return layer.id; });
  return {
    terrain: !!map.getTerrain(),
    hillshade: !!map.getLayer('hillshading'),
    hillshadeBelowRide: ids.indexOf('hillshading') >= 0 && ids.indexOf('hillshading') < ids.indexOf('ride-line'),
    ride: !!map.getLayer('ride-line'),
    rideSource: !!map.getSource('ride'),
    pitch: map.getPitch(),
    touchPitch: map.touchPitch.isEnabled(),
    dragRotate: map.dragRotate.isEnabled(),
  };
})()`;

/** Whether a request is for the DEM the surface page's terrain draws from. */
function isDemRequest(url: string): boolean {
  const template = terrain3DSource().tiles[0];
  return url.startsWith(template.slice(0, template.indexOf('{z}')));
}

async function openSurface(browser: Chromium, failing?: (url: string) => boolean) {
  const page = await browser.open({
    html: flatSurfaceHtml(),
    url: mapPageBaseUrl(),
    tileJsonUrls: tileJsonUrls(),
    failing,
  });
  await page.evaluate(HELPERS);
  await page.evaluate('window.__waitForMap(30000)');
  await page.evaluate(`window.__settle('first draw')`);
  await page.evaluate(buildApplyScript(RIDE_SPEC));
  await page.evaluate(`window.__settle('ride drawn')`);
  return page;
}

/** Every failure one page raises: map errors, uncaught page errors and a drive that threw. */
async function smoke(
  browser: Chromium,
  target: PageUnderTest,
  afterRenderer?: string
): Promise<{ failures: string[]; attributionControls: number }> {
  const page = await browser.open({
    html: target.html(),
    url: mapPageBaseUrl(),
    tileJsonUrls: tileJsonUrls(),
    afterRenderer,
  });
  const failures: string[] = [];
  try {
    await page.evaluate(HELPERS);
    await target.drive(page);
  } catch (error) {
    failures.push(`drive: ${(error as Error).message}`);
  }
  const attributionControls = await page
    .evaluate<number>("document.querySelectorAll('.maplibregl-ctrl-attrib').length")
    .catch(() => -1);
  failures.push(...page.errors());
  await page.close();
  return { failures, attributionControls };
}

const chromium = findChromium();

describe('the map pages in a headless Chromium', () => {
  let browser: Chromium;

  beforeAll(async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    if (!chromium) {
      throw new Error('No Chromium found. Install one or point CHROME_PATH at it.');
    }
    browser = await launchChromium(chromium);
  }, PAGE_TIMEOUT_MS);

  afterAll(async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    await browser?.close();
  });

  it.each(PAGES.map((target) => [target.name, target] as const))(
    '%s draws, takes terrain and swaps style with no map or page error',
    async (_name, target) => {
      const { failures, attributionControls } = await smoke(browser, target);

      expect(failures).toEqual([]);
      if (below(MAPLIBRE_GL_VERSION, ATTRIBUTION_SAFE_FROM)) {
        expect(attributionControls).toBe(0);
      }
    },
    PAGE_TIMEOUT_MS
  );

  it(
    'the map surface takes terrain from its patch, keeps it across a swap and drops it',
    async () => {
      const page = await openSurface(browser);
      const states: Record<string, SurfaceTerrainState> = {};
      try {
        await page.evaluate(buildApplyScript({ terrain: TILTED }));
        await page.evaluate(`window.__settle('terrain on')`);
        states.on = await page.evaluate<SurfaceTerrainState>(SURFACE_STATE);

        await page.evaluate(`${buildSetStyleScript('dark')}; window.__frameNow()`);
        await page.evaluate(`window.__settle('swap to dark')`);
        states.dark = await page.evaluate<SurfaceTerrainState>(SURFACE_STATE);

        await page.evaluate(`${buildSetStyleScript('satellite')}; window.__frameNow()`);
        await page.evaluate(`window.__settle('swap to satellite')`);
        states.satellite = await page.evaluate<SurfaceTerrainState>(SURFACE_STATE);

        await page.evaluate(`${buildSetStyleScript('light')}; window.__frameNow()`);
        await page.evaluate(`window.__settle('swap to light')`);
        await page.evaluate(buildApplyScript({ terrain: null }));
        await page.evaluate(`window.__settle('terrain off')`);
        states.off = await page.evaluate<SurfaceTerrainState>(SURFACE_STATE);
      } finally {
        await page.close();
      }

      expect(states.on).toMatchObject({
        terrain: true,
        hillshade: true,
        hillshadeBelowRide: true,
        ride: true,
        touchPitch: true,
        dragRotate: true,
      });
      expect(states.on.pitch).toBeGreaterThan(0);
      expect(states.dark).toMatchObject({
        terrain: true,
        hillshade: true,
        hillshadeBelowRide: true,
        ride: true,
        rideSource: true,
      });
      expect(states.dark.pitch).toBeGreaterThan(0);
      // Satellite imagery carries its own relief, so it takes no shading.
      expect(states.satellite).toMatchObject({
        terrain: true,
        hillshade: false,
        ride: true,
        rideSource: true,
      });
      expect(states.off).toMatchObject({
        terrain: false,
        hillshade: false,
        ride: true,
        pitch: 0,
        touchPitch: false,
        dragRotate: false,
      });
      expect(page.errors()).toEqual([]);
    },
    PAGE_TIMEOUT_MS
  );

  it(
    'the map surface reports a page with no elevation tiles',
    async () => {
      const page = await openSurface(browser, isDemRequest);
      let report: Record<string, unknown>;
      try {
        await page.evaluate(buildApplyScript({ terrain: TILTED }));
        report = await waitForPosted(
          page,
          (message) => message.type === 'terrainUnavailable',
          'no elevation tiles'
        );
      } finally {
        await page.close();
      }

      expect(String(report.reason)).toContain('none delivered');
      // The failed DEM requests are the only errors the page raised.
      expect(page.errors().filter((error) => !error.includes('[terrain]'))).toEqual([]);
    },
    PAGE_TIMEOUT_MS
  );

  it(
    'fails a renderer whose setTerrain throws',
    async () => {
      const broken =
        "maplibregl.Map.prototype.setTerrain = function() { throw new Error('setTerrain is broken'); };";

      const { failures } = await smoke(browser, PAGES[1], broken);

      expect(failures.some((failure) => failure.includes('setTerrain is broken'))).toBe(true);
    },
    PAGE_TIMEOUT_MS
  );
});
