/**
 * Expected behaviour: a section ridden both ways shows the direction the
 * performance panel is on as chevrons along the section line, every 80 px. The
 * chevron is the inverse of the line: a casing glyph outlined in the route
 * colour, so the glyph holds against the line and the outline against the
 * ground its arms reach onto. The direction is a rotation of the one symbol
 * layer on the section's own source, never a second line or source.
 */

import {
  buildSectionLayers,
  buildSectionSources,
} from '@/features/routes/components/sectionMapLayerSpecs';
import {
  ENDPOINT_AND_DIRECTION_IMAGES,
  directionColours,
} from '@/features/maps/lib/directionLayer';
import { DIRECTION_ICON_ID } from '@/features/maps/lib/mapIcons';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { mapPalette } from '@/theme';
import { contrastRatio } from '../__shared__/contrast';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

type Direction = 'forward' | 'reverse' | null;

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;
const input = (
  shownDirection: Direction,
  overrides: Record<string, unknown> = {},
  base: 'light' | 'dark' | 'satellite' = 'light'
) =>
  ({
    palette: mapPalette(base),
    shadowGeoJSON: empty,
    extensionGeoJSON: empty,
    sectionGeoJSON: empty,
    trimmedGeoJSON: empty,
    allTracesFeatureCollection: empty,
    highlightedLapGeoJSON: empty,
    highlightedTraceGeoJSON: empty,
    highlightedTraceFilter: undefined,
    hasAllTraces: false,
    endpoints: empty,
    sectionContext: false,
    trimRange: null,
    hasExtension: false,
    showExtensionAndSection: true,
    trimCasingWidth: 5,
    trimLineWidth: 4,
    traceCasingWidth: 5,
    traceLineWidth: 4,
    deltaLineStops: null,
    shownDirection,
    ...overrides,
  }) as unknown as Parameters<typeof buildSectionLayers>[0];

const chevrons = (layers: MapLayerSpec[]) => {
  const found = layers.filter(
    (l) =>
      l.type === 'symbol' && (l.layout as Record<string, unknown>)?.['symbol-placement'] === 'line'
  );
  expect(found).toHaveLength(1);
  return found[0]!;
};
const layout = (l: MapLayerSpec) => l.layout as Record<string, unknown>;
const paint = (l: MapLayerSpec) => l.paint as Record<string, unknown>;

describe('section map direction chevrons', () => {
  it.each(['light', 'dark', 'satellite'] as const)(
    'draws one chevron layer on the section source every 80 px in the %s casing',
    (base) => {
      const layer = chevrons(buildSectionLayers(input('forward', {}, base)));
      expect(layer.source).toBe('section');
      expect(layout(layer)).toMatchObject({
        'symbol-placement': 'line',
        'symbol-spacing': 80,
        'icon-image': DIRECTION_ICON_ID,
        'icon-allow-overlap': true,
      });
      expect(paint(layer)['icon-color']).toBe(mapPalette(base).casing);
      expect(paint(layer)['icon-opacity']).toBe(1);
    }
  );

  it.each(['light', 'dark', 'satellite'] as const)(
    'outlines the chevron in the %s route colour',
    (base) => {
      const layer = chevrons(buildSectionLayers(input('forward', {}, base)));
      expect(paint(layer)['icon-halo-color']).toBe(mapPalette(base).route);
      expect(paint(layer)['icon-halo-width']).toBeGreaterThan(0);
    }
  );

  it.each(['light', 'dark'] as const)(
    'holds the outline at 3:1 against every %s ground the arms reach onto',
    (base) => {
      const palette = mapPalette(base);
      const { outline } = directionColours(palette);
      for (const ground of [palette.land, palette.park, palette.water, palette.road]) {
        expect(contrastRatio(outline, ground)).toBeGreaterThanOrEqual(3);
      }
    }
  );

  it.each(['light', 'dark', 'satellite'] as const)(
    'holds the glyph at 3:1 against the %s line and every delta step',
    (base) => {
      const palette = mapPalette(base);
      const { glyph } = directionColours(palette);
      for (const line of [palette.route, ...Object.values(palette.div)]) {
        expect(contrastRatio(glyph, line)).toBeGreaterThanOrEqual(3);
      }
    }
  );

  it('flips the rotation with the shown direction', () => {
    const forward = layout(chevrons(buildSectionLayers(input('forward'))))['icon-rotate'];
    const reverse = layout(chevrons(buildSectionLayers(input('reverse'))))['icon-rotate'];
    expect(forward).toBe(0);
    expect(reverse).toBe(180);
  });

  it('draws the chevrons above the section line', () => {
    const layers = buildSectionLayers(input('forward'));
    const line = layers.findIndex((l) => l.id === 'section-line');
    expect(line).toBeGreaterThanOrEqual(0);
    expect(layers.indexOf(chevrons(layers))).toBeGreaterThan(line);
  });

  it('keeps the layer but shows nothing for a section ridden one way', () => {
    expect(paint(chevrons(buildSectionLayers(input(null))))['icon-opacity']).toBe(0);
  });

  it('shows nothing while the bounds are trimmed', () => {
    const layer = chevrons(
      buildSectionLayers(input('forward', { trimRange: { start: 0, end: 4 } }))
    );
    expect(paint(layer)['icon-opacity']).toBe(0);
  });

  it('draws them in fullscreen, where the base map draws the section line', () => {
    const layer = chevrons(
      buildSectionLayers(input('reverse', { showExtensionAndSection: false }))
    );
    expect(layer.source).toBe('section');
    expect(layout(layer)['icon-rotate']).toBe(180);
  });

  it('adds no second source for a direction', () => {
    expect(Object.keys(buildSectionSources(input('reverse')))).toEqual(
      Object.keys(buildSectionSources(input(null)))
    );
  });

  it('registers the chevron image beside the endpoint glyphs', () => {
    expect(ENDPOINT_AND_DIRECTION_IMAGES.map((image) => image.id)).toContain(DIRECTION_ICON_ID);
    expect(ENDPOINT_AND_DIRECTION_IMAGES.find((image) => image.id === DIRECTION_ICON_ID)?.sdf).toBe(
      true
    );
  });
});
