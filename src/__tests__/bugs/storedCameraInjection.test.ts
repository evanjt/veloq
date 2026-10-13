/**
 * Scenario: saved cameras are read back from settings that a restored backup
 * writes verbatim, and the map pages are built by writing each camera number
 * bare into page script. A stored zoom of `"1;evil()//"` ran as code, and a
 * centre that is not a pair broke the map on every launch.
 *
 * Expected behaviour: a stored camera that is not finite numbers and an
 * in-range centre reads as no saved camera, and a page builder handed a
 * non-number writes its default instead.
 */

import { buildMap3DHtml } from '@/features/maps/lib/htmlBuilders/map3D';
import type { Map3DHtmlConfig } from '@/features/maps/lib/htmlBuilders/map3D';
import { buildMapSurfaceHtml } from '@/features/maps/lib/htmlBuilders/mapSurface';
import type { MapSurfaceHtmlConfig } from '@/features/maps/lib/htmlBuilders/mapSurface';
import { jsNumber } from '@/features/maps/lib/webViewLiterals';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const HOSTILE = '1;globalThis.__injected=1//' as unknown as number;

function surfaceConfig(camera: MapSurfaceHtmlConfig['camera']): MapSurfaceHtmlConfig {
  return {
    style: 'light',
    camera,
    interaction: { scroll: true, zoom: true, rotate: true, pitch: false },
    devicePixelRatio: 2,
    reduceMotion: false,
    regionChangeThrottleMs: 100,
  };
}

function map3DConfig(overrides: Partial<Map3DHtmlConfig>): Map3DHtmlConfig {
  return {
    coordinates: [[7, 46]],
    bounds: null,
    centerOverride: [7, 46],
    zoom: 10,
    bearing: 0,
    pitch: 0,
    hasSavedCamera: true,
    terrainExaggeration: 1,
    initStyle: 'light',
    mapStyle: 'light',
    routeColor: '#000000',
    showHeatmap: false,
    devicePixelRatio: 2,
    reduceMotion: false,
    ...overrides,
  };
}

describe('jsNumber', () => {
  it('writes a finite number as itself', () => {
    expect(jsNumber(12.5, 0)).toBe('12.5');
    expect(jsNumber(-3, 0)).toBe('-3');
  });

  it('writes the fallback for anything else', () => {
    expect(jsNumber(HOSTILE, 12)).toBe('12');
    expect(jsNumber(NaN, 0)).toBe('0');
    expect(jsNumber(Infinity, 0)).toBe('0');
    expect(jsNumber(undefined, null)).toBe('null');
    expect(jsNumber(null, 2)).toBe('2');
  });
});

describe('a camera number written into the regional map page', () => {
  it('keeps a hostile zoom, bearing and pitch out of the script', () => {
    const html = buildMapSurfaceHtml(
      surfaceConfig({ center: [7, 46], zoom: HOSTILE, bearing: HOSTILE, pitch: HOSTILE })
    );

    expect(html).not.toContain('__injected');
    expect(html).toContain('options.zoom = 12;');
    expect(html).toContain('bearing: 0,');
    expect(html).toContain('pitch: 0,');
  });

  it('keeps a hostile max zoom out of the script', () => {
    const html = buildMapSurfaceHtml(
      surfaceConfig({ center: [7, 46], zoom: 10, maxZoom: HOSTILE })
    );

    expect(html).not.toContain('__injected');
    expect(html).toContain('var _maxZoom = null;');
  });

  it('writes a valid camera through unchanged', () => {
    const html = buildMapSurfaceHtml(
      surfaceConfig({ center: [7, 46], zoom: 9.5, bearing: 30, pitch: 45, maxZoom: 16 })
    );

    expect(html).toContain('options.zoom = 9.5;');
    expect(html).toContain('bearing: 30,');
    expect(html).toContain('pitch: 45,');
    expect(html).toContain('var _maxZoom = 16;');
  });
});

describe('a camera number written into the 3D map page', () => {
  it('keeps a hostile zoom, bearing and pitch out of the script', () => {
    const html = buildMap3DHtml(map3DConfig({ zoom: HOSTILE, bearing: HOSTILE, pitch: HOSTILE }));

    expect(html).not.toContain('__injected');
    expect(html).toContain('const savedZoom = 12;');
    expect(html).toContain('const savedBearing = 0;');
    expect(html).toContain('const savedPitch = 0;');
  });

  it('writes a valid camera through unchanged', () => {
    const html = buildMap3DHtml(map3DConfig({ zoom: 13.25, bearing: 210, pitch: 60 }));

    expect(html).toContain('const savedZoom = 13.25;');
    expect(html).toContain('const savedBearing = 210;');
    expect(html).toContain('const savedPitch = 60;');
  });
});

describe('the saved regional camera', () => {
  const STORAGE_KEY = '@map_camera_state';

  function freshModule(stored: string) {
    jest.resetModules();
    const { getEngine } = require('@/shared/native/engine');
    (getEngine as jest.Mock).mockReturnValue({
      getSetting: jest.fn((key: string) => (key === STORAGE_KEY ? stored : undefined)),
      setSetting: jest.fn(),
      deleteSetting: jest.fn(),
    });
    return require('@/features/maps/lib/storage/mapCameraState');
  }

  it.each([
    ['a null centre and a string zoom', { center: [null, null], zoom: 'x' }],
    ['a string zoom', { center: [7, 46], zoom: '1;evil()//' }],
    ['a centre of one number', { center: [7], zoom: 10 }],
    ['a centre of three numbers', { center: [7, 46, 0], zoom: 10 }],
    ['a latitude past the pole', { center: [7, 91], zoom: 10 }],
    ['a longitude past the antimeridian', { center: [181, 46], zoom: 10 }],
    ['no zoom', { center: [7, 46] }],
    ['an array', [7, 46]],
    ['a number', 5],
  ])('reads null from %s', (_name, value) => {
    const mod = freshModule(JSON.stringify(value));

    expect(mod.getMapCameraState()).toBeNull();
  });

  it('reads null from a malformed value through the async load too', async () => {
    const mod = freshModule(JSON.stringify({ center: [7, 46], zoom: '1;evil()//' }));
    await mod.reloadMapCameraState();
    (require('@/shared/native/engine').getEngine as jest.Mock).mockReturnValue(null);

    expect(mod.getMapCameraState()).toBeNull();
  });

  it('reads a camera on the boundary of the coordinate range', () => {
    const edge = { center: [-180, 90], zoom: 0 };
    const mod = freshModule(JSON.stringify(edge));

    expect(mod.getMapCameraState()).toEqual(edge);
  });
});

describe('the saved 3D cameras', () => {
  const STORAGE_KEY = '@terrain_camera_overrides';
  const GOOD = { center: [7, 46], zoom: 12, bearing: 90, pitch: 60 };

  async function loadFrom(stored: unknown) {
    jest.resetModules();
    jest.doMock('@/shared/storage', () => ({
      getSetting: jest.fn((key: string) =>
        Promise.resolve(key === STORAGE_KEY ? JSON.stringify(stored) : null)
      ),
      setSetting: jest.fn(() => Promise.resolve()),
      removeSetting: jest.fn(() => Promise.resolve()),
    }));
    jest.doMock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
      deleteTerrainPreviewsForActivity: jest.fn(() => Promise.resolve()),
    }));
    const mod = require('@/features/maps/lib/storage/terrainCameraOverrides');
    await mod.initCameraOverrides();
    return mod;
  }

  afterEach(() => {
    jest.dontMock('@/shared/storage');
    jest.dontMock('@/features/maps/lib/storage/terrainPreviewCache');
  });

  it('drops an entry whose zoom is not a finite number and keeps the rest', async () => {
    const mod = await loadFrom({
      kept: GOOD,
      hostile: { ...GOOD, zoom: '1;evil()//' },
    });

    expect(mod.getCameraOverride('kept')).toEqual(GOOD);
    expect(mod.getCameraOverride('hostile')).toBeUndefined();
  });

  it.each([
    ['a string bearing', { ...GOOD, bearing: '0;evil()' }],
    ['no pitch', { center: [7, 46], zoom: 12, bearing: 0 }],
    ['a centre that is not a pair', { ...GOOD, center: [7] }],
    ['a null entry', null],
  ])('drops an entry with %s', async (_name, entry) => {
    const mod = await loadFrom({ bad: entry });

    expect(mod.getCameraOverride('bad')).toBeUndefined();
    expect(mod.getCameraOverridesSnapshot().size).toBe(0);
  });

  it('loads nothing from a stored value that is not an object of cameras', async () => {
    const mod = await loadFrom([GOOD]);

    expect(mod.getCameraOverridesSnapshot().size).toBe(0);
  });
});
