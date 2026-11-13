/**
 * Scenario: a track's start and end markers differ only in hue, green against
 * red, which a red-green colour deficiency cannot tell apart.
 *
 * Expected behaviour: every map and thumbnail marks the start and the end with
 * different shapes, so the direction of travel reads without colour.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Circle, Rect } from 'react-native-svg';

import { buildActivityLayers } from '@/features/maps/components/activityMapLayerSpecs';
import { buildRouteLayers } from '@/features/routes/components/routeMapLayerSpecs';
import { buildSectionLayers } from '@/features/routes/components/sectionMapLayerSpecs';
import { SECTION_END_ICON_ID, SECTION_START_ICON_ID } from '@/features/maps/lib/mapIcons';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { TrackPreview, fitTrackToBox } from '@/shared/ui/TrackPreview';
import { mapPalette } from '@/theme';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

const activityLayers = () =>
  buildActivityLayers({
    palette: mapPalette('light'),
    overlayHasData: false,
    gradientActive: false,
    gradientLineExpression: null,
    hasSectionOverlays: false,
    highlightedSectionId: null,
    hasHighlightPoint: false,
    creationMode: false,
    hasUserLocation: false,
  });

const routeLayers = () =>
  buildRouteLayers({
    palette: mapPalette('light'),
    routeContext: false,
    fadedFilter: undefined,
    includeRoute: true,
  });

const sectionLayers = () =>
  buildSectionLayers({
    palette: mapPalette('light'),
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
    deltaBands: null,
    deltaGapsGeoJSON: empty,
  } as unknown as Parameters<typeof buildSectionLayers>[0]);

describe.each([
  ['activity', activityLayers],
  ['route', routeLayers],
  ['section', sectionLayers],
])('the %s map endpoints', (_name, build) => {
  const layers = build() as MapLayerSpec[];
  const endpointLayers = layers.filter((l) => l.source === 'endpoints');
  const glyph = endpointLayers.find((l) => l.type === 'symbol');

  it('draws a glyph over the endpoint dots that switches on position', () => {
    expect(glyph).toBeDefined();
    expect((glyph!.layout as Record<string, unknown>)['icon-image']).toEqual([
      'case',
      ['==', ['get', 'position'], 'start'],
      SECTION_START_ICON_ID,
      SECTION_END_ICON_ID,
    ]);
  });

  it('draws the glyph above the dots it labels', () => {
    const glyphIndex = layers.indexOf(glyph!);
    for (const dot of endpointLayers.filter((l) => l.type === 'circle')) {
      expect(layers.indexOf(dot)).toBeLessThan(glyphIndex);
    }
  });
});

describe('track thumbnail endpoints', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.2 },
    { x: 1, y: 1 },
  ];

  it('draws the end with a different shape from the start', async () => {
    const view = await render(<TrackPreview points={points} isDark={false} />);
    const [start, , finish] = fitTrackToBox(points, 48, 36, 4);
    const discsAt = (p: { x: number; y: number }) =>
      view.UNSAFE_getAllByType(Circle).filter((c) => c.props.cx === p.x && c.props.cy === p.y);
    const squaresAt = (p: { x: number; y: number }) =>
      view
        .UNSAFE_getAllByType(Rect)
        .filter(
          (r) => r.props.x + r.props.width / 2 === p.x && r.props.y + r.props.height / 2 === p.y
        );

    expect(discsAt(start).length).toBeGreaterThan(0);
    expect(squaresAt(start)).toHaveLength(0);
    expect(squaresAt(finish).length).toBeGreaterThan(0);
    expect(discsAt(finish)).toHaveLength(0);
  });

  it('draws nothing for a track too short to have two ends', async () => {
    const view = await render(<TrackPreview points={[{ x: 0, y: 0 }]} isDark />);
    expect(view.toJSON()).toBeNull();
  });
});
