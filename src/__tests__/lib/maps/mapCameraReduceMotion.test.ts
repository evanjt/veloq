/**
 * Scenario: the system reduce-motion setting is turned on while a map page is
 * open. The WebView reads its own copy of the setting only at process start, so
 * the page has to be told, and every camera move the app scripts has to read
 * what it was told when it runs rather than a duration baked in at build time.
 *
 * Expected behaviour: with `window._veloqReduceMotion` set, every scripted
 * camera move lands at once; with it clear, the move eases over the duration
 * the caller asked for. A page built with reduce motion on hands MapLibre its
 * `reduceMotion` option, so its own easing jumps from the first frame.
 */

import vm from 'vm';

import {
  buildFitBoundsScript,
  buildMapSurfaceHtml,
  buildResetOrientationScript,
  buildSetCameraScript,
  type MapSurfaceHtmlConfig,
} from '@/features/maps/lib/htmlBuilders/mapSurface';
import {
  buildMap3DHtml,
  buildSetRouteScript,
  type Map3DHtmlConfig,
} from '@/features/maps/lib/htmlBuilders';

type Move = { method: string; options: Record<string, unknown> };

/** The duration a move actually runs for. A jump runs for none. */
function durationOf(move: Move): number {
  if (move.method === 'jumpTo') return 0;
  const duration = move.options.duration;
  return typeof duration === 'number' ? duration : -1;
}

function runInjected(script: string, reduceMotion: boolean): Move[] {
  const moves: Move[] = [];
  const record =
    (method: string, optionsAt: number) =>
    (...args: unknown[]) =>
      moves.push({ method, options: (args[optionsAt] ?? {}) as Record<string, unknown> });
  const sandbox: Record<string, unknown> = {
    JSON,
    map: {
      jumpTo: record('jumpTo', 0),
      easeTo: record('easeTo', 0),
      flyTo: record('flyTo', 0),
      fitBounds: record('fitBounds', 1),
    },
    _veloq3d: { setRoute: () => {} },
    _veloqReduceMotion: reduceMotion,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(script, sandbox);
  return moves;
}

const BOUNDS = { sw: [7.4, 46.9] as [number, number], ne: [7.5, 47] as [number, number] };

const SCRIPTS: { name: string; script: string; duration: number }[] = [
  {
    name: 'a centre and zoom camera',
    script: buildSetCameraScript({ center: [7.45, 46.95], zoom: 13 }, 400),
    duration: 400,
  },
  {
    name: 'a bounds camera',
    script: buildSetCameraScript({ bounds: BOUNDS }, 400),
    duration: 400,
  },
  { name: 'a bounds fit', script: buildFitBoundsScript(BOUNDS, 40, 400), duration: 400 },
  { name: 'the orientation reset', script: buildResetOrientationScript(), duration: 500 },
  {
    name: 'the 3D route fit',
    script: buildSetRouteScript(
      [
        [7.4, 46.9],
        [7.5, 47],
      ],
      BOUNDS
    ),
    duration: 600,
  },
];

describe('scripted camera moves follow the live reduce-motion setting', () => {
  it.each(SCRIPTS)('$name lands at once with reduce motion on', ({ script }) => {
    const moves = runInjected(script, true);
    expect(moves).toHaveLength(1);
    expect(durationOf(moves[0])).toBe(0);
  });

  it.each(SCRIPTS)(
    '$name eases over its duration with reduce motion off',
    ({ script, duration }) => {
      const moves = runInjected(script, false);
      expect(moves).toHaveLength(1);
      expect(durationOf(moves[0])).toBe(duration);
    }
  );

  it('follows a change made after the script was built', () => {
    const script = buildFitBoundsScript(BOUNDS, 40, 400);
    expect(durationOf(runInjected(script, false)[0])).toBe(400);
    expect(durationOf(runInjected(script, true)[0])).toBe(0);
  });

  it('never marks a move essential, which would override the reduced-motion jump', () => {
    for (const { script } of SCRIPTS) {
      for (const move of runInjected(script, false)) {
        expect(move.options.essential).toBeUndefined();
      }
    }
  });
});

function extractPageScript(html: string): string {
  const blocks = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*maplibre-gl)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  expect(blocks.length).toBe(1);
  return blocks[0][1];
}

/** Runs a page up to the map constructor and returns what it was given. */
function mapOptionsOf(html: string): {
  options: Record<string, unknown> | null;
  pageFlag: unknown;
} {
  let options: Record<string, unknown> | null = null;
  const sandbox: Record<string, unknown> = {
    JSON,
    Math,
    Date,
    String,
    Number,
    Array,
    Object,
    Promise,
    Error,
    console: { log: () => {}, warn: () => {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    fetch: () => new Promise(() => {}),
    caches: {
      keys: () => new Promise(() => {}),
      open: () => new Promise(() => {}),
      delete: () => new Promise(() => {}),
    },
    document: { getElementById: () => ({ addEventListener: () => {}, style: {} }) },
    addEventListener: () => {},
    maplibregl: {
      addProtocol: () => {},
      Map: function MapCtor(given: Record<string, unknown>) {
        options = given;
        // The rest of the page is not under test here.
        throw new Error('stop');
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(extractPageScript(html), sandbox);
  return { options, pageFlag: sandbox._veloqReduceMotion };
}

function surfaceConfig(reduceMotion: boolean): MapSurfaceHtmlConfig {
  return {
    style: 'light',
    camera: { center: [7.448, 46.949], zoom: 12 },
    interaction: { scroll: true, zoom: true, rotate: true, pitch: false },
    devicePixelRatio: 2,
    regionChangeThrottleMs: 100,
    longPressMs: 500,
    reduceMotion,
  };
}

function map3DConfig(reduceMotion: boolean): Map3DHtmlConfig {
  return {
    coordinates: [
      [7.447, 46.948],
      [7.449, 46.95],
    ],
    bounds: { sw: [7.447, 46.948], ne: [7.449, 46.95] },
    centerOverride: null,
    zoom: 12,
    bearing: 0,
    pitch: 60,
    hasSavedCamera: false,
    terrainExaggeration: 1.5,
    initStyle: 'light',
    mapStyle: 'light',
    routeColor: '#FF6B35',
    showHeatmap: false,
    devicePixelRatio: 2,
    reduceMotion,
  };
}

describe('a map page starts from the reduce-motion setting it was built with', () => {
  it.each([
    ['2D surface', (on: boolean) => buildMapSurfaceHtml(surfaceConfig(on))],
    ['3D terrain', (on: boolean) => buildMap3DHtml(map3DConfig(on))],
  ])('%s page hands MapLibre the setting and keeps its own copy', (_name, build) => {
    const on = mapOptionsOf(build(true));
    expect(on.options?.reduceMotion).toBe(true);
    expect(on.pageFlag).toBe(true);

    const off = mapOptionsOf(build(false));
    expect(off.options?.reduceMotion).toBe(false);
    expect(off.pageFlag).toBe(false);
  });
});
