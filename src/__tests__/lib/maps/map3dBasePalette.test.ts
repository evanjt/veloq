/**
 * Expected behaviour: the 3D page, its style swap and the feed snapshots draw
 * with the palette of the base under them. The route is the 2D subject line at
 * 0.75 of its width on a casing at full opacity, the ends carry the 2D marker
 * glyphs, the matched route is the muted context line with no casing, and the
 * sky, horizon, fog and hillshade are the base's own.
 */
import { mapPalette, type MapBase } from '@/theme';
import {
  buildMap3DHtml,
  buildMap3DSetStyleScript,
  buildUpdateLayersScript,
} from '@/features/maps/lib/htmlBuilders';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import { SECTION_END_ICON_ID, SECTION_START_ICON_ID } from '@/features/maps/lib/mapIcons';
import { bootWorkerPage } from '../../__shared__/snapshotWorkerPage';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

interface Layer {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}
interface Style {
  sources: Record<string, unknown>;
  layers: Layer[];
  sky?: Record<string, unknown>;
}

const track: [number, number][] = [
  [7.3, 46.2],
  [7.31, 46.21],
];

const matched: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: track },
    },
  ],
};

function layer(style: Style, id: string): Layer {
  const found = style.layers.find((l) => l.id === id);
  if (!found) throw new Error(`no layer ${id}`);
  return found;
}

/** Every colour a base draws with that another base does not share. */
function valuesOnlyOn(base: MapBase, other: MapBase): string[] {
  const own = mapPalette(base);
  const theirs = mapPalette(other);
  const pick = (p: typeof own) => [
    p.route,
    p.casing,
    p.muted,
    p.start,
    p.ink,
    p.record,
    p.badgeInk,
    p.sky,
    p.horizon,
    p.fog,
    ...('hillshade' in p ? [p.hillshade.shadow, p.hillshade.highlight] : []),
  ];
  const shared = new Set(pick(theirs).map((v) => v.toLowerCase()));
  return pick(own)
    .map((v) => v.toLowerCase())
    .filter((v) => !shared.has(v));
}

/** The style a swap to `mapStyle` hands MapLibre, on a page that was sent a matched route. */
function swapTo(mapStyle: MapBase): Style {
  let applied: Style | null = null;
  const win: Record<string, unknown> = {
    map: {
      getTerrain: () => null,
      setTerrain: () => {},
      setStyle: (style: Style) => {
        applied = style;
      },
      once: () => {},
      on: () => {},
      hasImage: () => true,
    },
    _routeCoords: track,
    _veloq3d: { lines: { routes: matched } },
  };
  new Function(
    'window',
    'fetch',
    'Image',
    buildMap3DSetStyleScript({
      mapStyle,
      routeColor: mapPalette(mapStyle).route,
      terrainExaggeration: 1.5,
      heatmapGeneration: 0,
      showHeatmap: false,
    })
  )(win, () => new Promise(() => {}), undefined);
  if (!applied) throw new Error('the swap set no style');
  return applied;
}

function pageHtml(base: MapBase): string {
  return buildMap3DHtml({
    coordinates: track,
    bounds: null,
    centerOverride: null,
    zoom: 12,
    bearing: 0,
    pitch: 60,
    hasSavedCamera: false,
    terrainExaggeration: 1.5,
    initStyle: base,
    mapStyle: base,
    routeColor: mapPalette(base).route,
    showHeatmap: false,
    devicePixelRatio: 1,
    reduceMotion: false,
  }).toLowerCase();
}

describe('the 3D page built for a base', () => {
  it('draws the dark casing and sky and no light value', () => {
    const html = pageHtml('dark');
    const dark = mapPalette('dark');

    expect(html).toContain(dark.casing.toLowerCase());
    expect(html).toContain(dark.sky.toLowerCase());
    expect(html).toContain(dark.hillshade.shadow.toLowerCase());
    for (const value of valuesOnlyOn('light', 'dark')) expect(html).not.toContain(value);
  });

  it('draws the light set and no dark value', () => {
    const html = pageHtml('light');

    for (const value of valuesOnlyOn('dark', 'light')) expect(html).not.toContain(value);
  });

  it('builds its layer updates from the palette it is given', () => {
    const script = buildUpdateLayersScript(
      { routesGeoJSON: matched, sectionTrimGeoJSON: matched },
      mapPalette('satellite')
    ).toLowerCase();

    expect(script).toContain(mapPalette('satellite').muted.toLowerCase());
    for (const value of valuesOnlyOn('light', 'satellite')) expect(script).not.toContain(value);
  });
});

describe('the 3D style swap', () => {
  it('carries the satellite set after a cycle to satellite, with no hillshade', () => {
    const style = swapTo('satellite');
    const satellite = mapPalette('satellite');

    expect(style.sky).toMatchObject({
      'sky-color': satellite.sky,
      'horizon-color': satellite.horizon,
      'fog-color': satellite.fog,
    });
    expect(style.layers.map((l) => l.id)).not.toContain('hillshading');
    expect(layer(style, 'route-outline').paint).toMatchObject({
      'line-color': satellite.casing,
      'line-opacity': 1,
    });
    expect(layer(style, 'route-line').paint).toMatchObject({
      'line-color': satellite.route,
      'line-width': 3,
    });
  });

  it('shades the light relief from the light hillshade pair', () => {
    const style = swapTo('light');
    const light = mapPalette('light');

    expect(layer(style, 'hillshading').paint).toMatchObject({
      'hillshade-shadow-color': light.hillshade.shadow,
      'hillshade-highlight-color': light.hillshade.highlight,
    });
    expect(style.sky).toMatchObject({ 'sky-color': light.sky });
  });

  it('draws the route casing a quarter narrower than the flat map, at full opacity', () => {
    const outline = layer(swapTo('dark'), 'route-outline').paint ?? {};

    expect(outline['line-opacity']).toBe(1);
    expect(outline['line-width']).toBe(3.75);
  });

  it('marks the start with a triangle and the finish with a square, in start and ink', () => {
    const style = swapTo('dark');
    const dark = mapPalette('dark');

    expect(JSON.stringify(layer(style, 'start-end-fill').paint)).toBe(
      JSON.stringify({
        'circle-radius': 5.25,
        'circle-color': ['case', ['==', ['get', 'type'], 'start'], dark.start, dark.ink],
      })
    );
    const icon = layer(style, 'start-end-icon');
    expect(JSON.stringify(icon.layout?.['icon-image'])).toBe(
      JSON.stringify([
        'case',
        ['==', ['get', 'type'], 'start'],
        SECTION_START_ICON_ID,
        SECTION_END_ICON_ID,
      ])
    );
    expect(icon.paint?.['icon-color']).toBe(dark.casing);
  });

  it('draws the matched route as the muted context line with no casing', () => {
    const style = swapTo('dark');

    expect(style.layers.map((l) => l.id)).not.toContain('routes-layer-outline');
    expect(layer(style, 'routes-layer').paint).toMatchObject({
      'line-color': mapPalette('dark').muted,
      'line-width': 6,
      'line-opacity': 1,
    });
  });
});

describe('a feed snapshot', () => {
  const request = (mapStyle: MapBase): SnapshotRequest => ({
    activityId: 'canoe-reach',
    coordinates: track,
    camera: { center: [7.305, 46.205], zoom: 12, bearing: 0, pitch: 60 },
    mapStyle,
  });

  it.each(['light', 'dark', 'satellite'] as const)(
    'draws the %s subject colour on its casing with its sky',
    (base) => {
      const page = bootWorkerPage();
      page.render(request(base), 1);
      const style = page.map.setStyle.mock.calls[0]?.[0] as Style;
      const palette = mapPalette(base);

      expect(style.sky).toMatchObject({ 'sky-color': palette.sky });
      expect(layer(style, 'route-line').paint).toMatchObject({
        'line-color': palette.route,
        'line-width': 3,
      });
      expect(layer(style, 'route-outline').paint).toMatchObject({
        'line-color': palette.casing,
        'line-opacity': 1,
      });
      expect(style.layers.map((l) => l.id)).toContain('start-end-icon');
    }
  );
});
