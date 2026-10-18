/**
 * Expected behaviour: a section ridden both ways shows the direction the
 * performance panel is on as chevrons along the section line, every 80 px, in
 * the base's casing colour over the line. The direction is a rotation of the
 * one symbol layer on the section's own source, never a second line or source.
 */

import {
  buildSectionLayers,
  buildSectionSources,
} from '@/features/routes/components/sectionMapLayerSpecs';
import { ENDPOINT_AND_DIRECTION_IMAGES } from '@/features/maps/lib/directionLayer';
import { DIRECTION_ICON_ID } from '@/features/maps/lib/mapIcons';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { mapPalette } from '@/theme';

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
