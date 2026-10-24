/**
 * Scenario: an activity, a lap or a trace is laid over the section on its map.
 * Expected behaviour: the section's lines and its delta gaps are drawn above every activity
 * line, so the section stays visible beneath the activity's casing and ink.
 */

import { buildSectionLayers } from '@/features/routes/components/sectionMapLayerSpecs';
import { mapPalette } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

const layers = buildSectionLayers({
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
  sectionContext: true,
  trimRange: null,
  hasExtension: false,
  showExtensionAndSection: true,
  trimCasingWidth: 5,
  trimLineWidth: 4,
  traceCasingWidth: 5,
  traceLineWidth: 4,
  deltaGapsGeoJSON: empty,
  shownDirection: null,
} as unknown as Parameters<typeof buildSectionLayers>[0]);

const indexOf = (id: string) => layers.findIndex((l) => l.id === id);

describe('section map layer order', () => {
  const activityLayers = [
    'all-traces-casing',
    'all-traces-line',
    'highlighted-lap-casing',
    'highlighted-lap-line',
    'highlighted-trace-casing',
    'highlighted-trace-line',
  ];
  const sectionLayers = ['section-casing', 'section-line', 'section-direction'];

  it.each(sectionLayers)('draws %s above every activity layer', (sectionId) => {
    expect(indexOf(sectionId)).toBeGreaterThan(-1);
    for (const activityId of activityLayers) {
      expect(indexOf(activityId)).toBeGreaterThan(-1);
      expect(indexOf(sectionId)).toBeGreaterThan(indexOf(activityId));
    }
  });
});
