import { runInNewContext } from 'node:vm';
/**
 * Contract tests for the snapshot render script generator.
 *
 * Scenario: the same generator now produces two render modes - the 3D terrain
 * drape and a flat top-down basemap for feed cards without interesting terrain.
 * Expected behaviour: flat scripts contain no terrain/sky/hillshade injection,
 * carry pitch 0, and 3D output is unchanged by the flat flag's existence.
 */

import {
  buildRenderSnapshotScript,
  snapshotRenderScript,
  SNAPSHOT_JPEG_QUALITY,
  QUALITY_CACHE_VERSION,
} from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import { SNAPSHOT_PHASES } from '@/features/maps/lib/snapshotTiming';
import { TERRAIN_CACHE_VERSION } from '@/features/maps/lib/storage/terrainPreviewCache';
import type {
  SnapshotRequest,
  SnapshotStylesHeld,
} from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import { mapLayerColors } from '@/theme/colors';

/**
 * What one request runs on the page: the page's render function, as the
 * worker page defines it at load, and then the request itself.
 */
function pageRender(request: SnapshotRequest, gen: number): string {
  return `${snapshotRenderScript()}\n${buildRenderSnapshotScript(request, 0, gen)}`;
}

function makeRequest(overrides: Partial<SnapshotRequest> = {}): SnapshotRequest {
  return {
    activityId: 'act-1',
    coordinates: [
      [7.0, 46.0],
      [7.1, 46.1],
    ],
    camera: { center: [7.05, 46.05], zoom: 12, bearing: 30, pitch: 58 },
    mapStyle: 'light',
    routeColor: '#14B8A6',
    ...overrides,
  };
}

describe('buildRenderSnapshotScript', () => {
  it('reads route casing from the shared map palette', () => {
    const layers = mapLayerColors as { casing: string };
    const casing = layers.casing;

    try {
      layers.casing = '#123456';
      expect(snapshotRenderScript()).toContain('\'line-color\': "#123456"');
    } finally {
      layers.casing = casing;
    }
  });

  it('injects terrain, sky, and hillshade for 3D requests', () => {
    const page = snapshotRenderScript();
    expect(page).toContain("styleObj.sources['terrain'] = terrainSource");
    expect(page).toContain('styleObj.sky = skyConfig');
    expect(page).toContain("id: 'hillshading'");
    expect(buildRenderSnapshotScript(makeRequest(), 0, 1)).toContain('"isFlat":false');
  });

  it('marks flat requests so terrain injection is skipped at runtime', () => {
    expect(buildRenderSnapshotScript(makeRequest({ flat: true }), 0, 1)).toContain('"isFlat":true');
    // Terrain injection is behind the isFlat guard
    const page = snapshotRenderScript();
    expect(page).toContain('if (!isFlat) {');
    expect(page).toContain('if (!isFlat && !isSatellite) {');
  });

  it('applies the request camera verbatim, including pitch 0 for flat', () => {
    const flatCamera = {
      center: [7.05, 46.05] as [number, number],
      zoom: 12,
      bearing: 0,
      pitch: 0,
    };
    const script = buildRenderSnapshotScript(makeRequest({ flat: true, camera: flatCamera }), 0, 1);
    expect(script).toContain(JSON.stringify(flatCamera));
  });

  it('tracks base mode so a flat/3D flip cannot reuse the fast path', () => {
    const script = snapshotRenderScript();
    expect(script).toContain("var baseMode = isFlat ? 'flat' : '3d'");
    expect(script).toContain('window._currentBaseMode === baseMode');
    expect(script).toContain('window._currentBaseMode = baseMode');
  });

  it('keeps gap detection exclusive to 3D renders', () => {
    const script = snapshotRenderScript();
    expect(script).toContain('if (ctx && !isFlat) {');
    expect(script).toContain('if (ctx && (!isFlat || isSatellite)) {');
  });

  it('always includes the route layers regardless of mode', () => {
    // One render function serves both modes, so the layers are in it once for
    // the fast path and once for the full one.
    const script = snapshotRenderScript();
    expect(script.match(/id: 'route-line'/g)).toHaveLength(2);
    expect(script.match(/id: 'route-outline'/g)).toHaveLength(2);
    expect(script.match(/id: 'start-end-fill'/g)).toHaveLength(2);
  });
});

/**
 * Scenario: a feed preview is a 1080x720 JPEG drawn once, shown at about a
 * third of a screen height under a route line, and never zoomed. It was
 * encoded at 0.95, which is the setting for an image that will be re-encoded,
 * and cost a measured 240 KB each on a real device.
 * Expected behaviour: the encode reads a named constant rather than a literal,
 * and that constant stays in the band a thumbnail wants. A change to it has to
 * move `TERRAIN_CACHE_VERSION` too, or every preview already on a device keeps
 * being served at the old setting for the life of the install.
 */
describe('the snapshot encode', () => {
  it('encodes through the shared constant, not a literal in the script', () => {
    const script = snapshotRenderScript();

    expect(script).toContain(`canvas.toDataURL('image/jpeg', ${SNAPSHOT_JPEG_QUALITY})`);
  });

  it('keeps the quality in the band a feed thumbnail wants', () => {
    // Below 0.7 the route line's edge starts to show against satellite; at
    // 0.95 the file is twice the size for a difference measured at 1.8% RMSE.
    expect(SNAPSHOT_JPEG_QUALITY).toBeGreaterThanOrEqual(0.7);
    expect(SNAPSHOT_JPEG_QUALITY).toBeLessThanOrEqual(0.85);
  });

  it('has a cache version recorded against the quality it was drawn at', () => {
    // The pair moves together. A device holds previews drawn at whatever the
    // quality was when they were made, and only a version bump redraws them.
    expect(TERRAIN_CACHE_VERSION).toBeGreaterThanOrEqual(QUALITY_CACHE_VERSION);
  });
});

/**
 * Scenario: the page's own elapsed says the render is the whole of a preview's
 * wait, and nothing says which part of the render that is.
 *
 * Expected behaviour: the script stamps the four stages the host knows how to
 * record, and stamps no fifth. The names are the join between a string this
 * module builds and a table a reader reads, so a rename on either side has to
 * fail here.
 */
describe('the stages a render stamps', () => {
  const stamped = (script: string) =>
    new Set(Array.from(script.matchAll(/\bphase\('([a-z]+)'\)/g), (m) => m[1]));

  it('stamps exactly the stages the pool records, in the one function both modes run', () => {
    expect([...stamped(snapshotRenderScript())].sort()).toEqual([...SNAPSHOT_PHASES].sort());
  });

  it('carries them back on the message that carries the image', () => {
    const script = snapshotRenderScript();
    expect(script).toContain('phases: window._phases');
  });

  it('closes the style stage on both the fast path and the full one', () => {
    // The fast path mounts no style, so its style stage is the camera jump
    // alone. A stamp only on the full path would read as the fast path
    // spending its whole elapsed settling.
    const script = snapshotRenderScript();
    expect(script.match(/phase\('style'\)/g)).toHaveLength(2);
  });
});

describe('tile counts belong to one render', () => {
  it.each(['fast', 'setStyle'] as const)(
    'starts successive %s renders before counting map events',
    (path) => {
      const starts: Record<string, { loaded: number; total: number }>[] = [];
      const postMessage = jest.fn();
      const page = {
        _tileStats: { old: { loaded: 9, total: 10 } } as Record<
          string,
          { loaded: number; total: number }
        >,
        _currentBaseStyle: path === 'fast' ? 'dark' : null,
        _currentBaseMode: 'flat',
        _rn_log: jest.fn(),
        _heartbeat: { start: jest.fn() },
        ReactNativeWebView: { postMessage },
        map: {
          getTerrain: () => null,
          setStyle: jest.fn(() => {
            starts.push({ ...page._tileStats });
            // MapLibre can report a source synchronously while mounting a style.
            page._tileStats.vector = { loaded: 1, total: 2 };
          }),
          jumpTo: jest.fn(() => {
            if (path === 'fast') starts.push({ ...page._tileStats });
            page._tileStats.camera = { loaded: 1, total: 1 };
          }),
          on: jest.fn(),
          getSource: () => undefined,
          addSource: jest.fn(),
          addLayer: jest.fn(),
          removeSource: jest.fn(),
          removeLayer: jest.fn(),
        },
      };
      for (const generation of [1, 2]) {
        const script = pageRender(makeRequest({ mapStyle: 'dark', flat: true }), generation);
        new Function('window', 'setInterval', 'setTimeout', 'requestAnimationFrame', script)(
          page,
          jest.fn(),
          jest.fn(),
          jest.fn()
        );
        expect(postMessage).not.toHaveBeenCalled();
        expect(page._tileStats).toEqual(
          path === 'fast'
            ? { camera: { loaded: 1, total: 1 } }
            : { vector: { loaded: 1, total: 2 }, camera: { loaded: 1, total: 1 } }
        );
      }
      expect(starts).toEqual([{}, {}]);
      expect(page.map.setStyle).toHaveBeenCalledTimes(path === 'fast' ? 0 : 2);
    }
  );
});

it.each([false, true])(
  'posts tile counts after capture, including encode failure=%s',
  (failEncode) => {
    jest.useFakeTimers();
    try {
      const postMessage = jest.fn();
      const page = {
        _tileStats: {} as Record<string, { loaded: number; total: number }>,
        _rn_log: jest.fn(),
        _heartbeat: { start: jest.fn() },
        ReactNativeWebView: { postMessage },
        map: {
          getTerrain: () => null,
          setStyle: () => {
            page._tileStats.terrain = { loaded: 3, total: 4 };
          },
          jumpTo: jest.fn(),
          isStyleLoaded: () => true,
          getCanvas: () => ({
            width: 1080,
            height: 720,
            getContext: () => null,
            toDataURL: () => {
              if (failEncode) throw new Error('encode failed');
              return 'data:image/jpeg;base64,AAAA';
            },
          }),
        },
      };
      const script = pageRender(makeRequest({ mapStyle: 'dark', flat: true }), 1);
      new Function(
        'window',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'requestAnimationFrame',
        script
      )(page, setInterval, clearInterval, setTimeout, (callback: () => void) => callback());
      jest.advanceTimersByTime(250);
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({
        type: failEncode ? 'snapshotError' : 'snapshot',
        tileStats: { terrain: { loaded: 3, total: 4 } },
        phases: { style: 0, settle: 250 },
      });
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  }
);

describe.each([true, false])('fast snapshot settle (flat=%s)', (flat) => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function render() {
    const idle: (() => void)[] = [];
    const layers: string[] = [];
    const layersAtIdle: string[][] = [];
    const postMessage = jest.fn();
    const map = {
      jumpTo: jest.fn(),
      getSource: () => ({}),
      removeSource: jest.fn(),
      removeLayer: jest.fn(),
      addSource: jest.fn(),
      addLayer: (layer: { id: string }) => layers.push(layer.id),
      on: jest.fn(),
      off: jest.fn(),
      once: (_event: string, callback: () => void) => {
        layersAtIdle.push([...layers]);
        idle.push(callback);
      },
      isStyleLoaded: jest.fn(() => true),
      getCanvas: () => ({
        width: 1080,
        height: 720,
        getContext: () => null,
        toDataURL: () => 'data:image/jpeg;base64,cGljdHVyZQ==',
      }),
    };
    const page = {
      map,
      _currentBaseStyle: 'light',
      _currentBaseMode: flat ? 'flat' : '3d',
      _snapshotGen: 1,
      _heartbeat: { start: jest.fn() },
      _rn_log: jest.fn(),
      ReactNativeWebView: { postMessage },
    };
    runInNewContext(pageRender(makeRequest({ flat }), 1), {
      window: page,
      Date,
      setTimeout,
      setInterval,
      clearInterval,
      requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
    });
    return { idle, layersAtIdle, postMessage, map, page };
  }

  it('includes the route in the first idle cycle and captures once', () => {
    const result = render();
    jest.advanceTimersByTime(16);
    expect(result.layersAtIdle).toEqual([
      ['route-outline', 'route-line', 'start-end-border', 'start-end-fill'],
    ]);
    result.idle.shift()!();
    jest.advanceTimersByTime(6000);
    expect(result.postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.postMessage.mock.calls[0][0])).toMatchObject({
      type: 'snapshot',
      fastPath: true,
      base64: 'cGljdHVyZQ==',
    });
  });

  it('captures a loaded style on the first 200ms poll without a data event', () => {
    const result = render();
    jest.advanceTimersByTime(266);
    expect(result.postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.postMessage.mock.calls[0][0]).type).toBe('snapshot');
  });

  it('never captures an unloaded style, and fails it at the deadline', () => {
    const result = render();
    result.map.isStyleLoaded.mockReturnValue(false);
    jest.advanceTimersByTime(5900);
    expect(result.postMessage).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(result.postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.postMessage.mock.calls[0][0]).type).toBe('snapshotError');
  });

  it('does not capture a superseded request', () => {
    const result = render();
    result.page._snapshotGen++;
    jest.advanceTimersByTime(6000);
    expect(result.postMessage).not.toHaveBeenCalled();
  });
});

/**
 * Scenario: a feed fill sends one request per preview to two worker pages, and
 * every request carried the whole basemap style and the render code with it,
 * about 68 K characters for a light preview, though the page lives for the
 * whole feed and already held both.
 *
 * Expected behaviour: a page is given a style once. A request for a style it
 * holds carries only the request, and a page that holds nothing, or holds a
 * style that has since changed, is given it again.
 */
describe('a request to a worker page that holds its style', () => {
  const registrations = (script: string) => script.match(/window\._styles\[/g)?.length ?? 0;

  it('gives the page the style with its first request, once', () => {
    const held: SnapshotStylesHeld = new Map();
    const script = buildRenderSnapshotScript(makeRequest(), 0, 1, held);

    expect(registrations(script)).toBe(1);
    expect(script).toContain('layers');
  });

  it('sends only the request once the page holds the style', () => {
    const held: SnapshotStylesHeld = new Map();
    buildRenderSnapshotScript(makeRequest(), 0, 1, held);
    const script = buildRenderSnapshotScript(makeRequest({ activityId: 'act-2' }), 0, 2, held);

    expect(script.length).toBeLessThan(5000);
    expect(registrations(script)).toBe(0);
    expect(script).not.toContain('layers');
  });

  it('sends only the request for a held style in the other mode', () => {
    const held: SnapshotStylesHeld = new Map();
    buildRenderSnapshotScript(makeRequest({ flat: true }), 0, 1, held);

    expect(registrations(buildRenderSnapshotScript(makeRequest(), 0, 2, held))).toBe(0);
  });

  it('gives the page each style it does not hold yet', () => {
    const held: SnapshotStylesHeld = new Map();
    buildRenderSnapshotScript(makeRequest(), 0, 1, held);

    for (const mapStyle of ['dark', 'satellite'] as const) {
      expect(registrations(buildRenderSnapshotScript(makeRequest({ mapStyle }), 0, 2, held))).toBe(
        1
      );
    }
    expect(registrations(buildRenderSnapshotScript(makeRequest(), 0, 3, held))).toBe(0);
  });

  it('gives a fresh page the style again', () => {
    const held: SnapshotStylesHeld = new Map();
    buildRenderSnapshotScript(makeRequest(), 0, 1, held);
    held.clear();

    expect(registrations(buildRenderSnapshotScript(makeRequest(), 0, 2, held))).toBe(1);
  });

  it('gives the page a style again when it differs from the one it holds', () => {
    const held: SnapshotStylesHeld = new Map([['light', '{"version":8}']]);

    expect(registrations(buildRenderSnapshotScript(makeRequest(), 0, 1, held))).toBe(1);
  });
});
