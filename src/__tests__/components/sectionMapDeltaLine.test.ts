import {
  buildSectionLayers,
  buildSectionSources,
} from '@/features/routes/components/sectionMapLayerSpecs';

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;
const input = (deltaLineStops: (string | number)[] | null) =>
  ({
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
    activityColor: '#123456',
    sectionOpacity: 1,
    trimRange: null,
    hasExtension: false,
    showExtensionAndSection: true,
    trimCasingWidth: 5,
    trimLineWidth: 4,
    traceCasingWidth: 5,
    traceLineWidth: 4,
    deltaLineStops,
  }) as unknown as Parameters<typeof buildSectionLayers>[0];

const sectionLine = (stops: (string | number)[] | null) =>
  buildSectionLayers(input(stops)).find((l) => l.id === 'section-line')!;

describe('section map delta line', () => {
  it('declares the section source with line metrics in every mode', () => {
    for (const stops of [null, [0, '#000000', 1, '#ffffff']]) {
      expect(buildSectionSources(input(stops)).section).toMatchObject({ lineMetrics: true });
    }
  });

  it('paints a line-gradient over line-progress while delta stops are given', () => {
    const paint = sectionLine([0, '#000000', 1, '#ffffff']).paint as Record<string, unknown>;
    expect(paint['line-gradient']).toEqual([
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      '#000000',
      1,
      '#ffffff',
    ]);
    expect(paint['line-color']).toBeUndefined();
  });

  it('keeps the flat colour without delta stops', () => {
    const paint = sectionLine(null).paint as Record<string, unknown>;
    expect(paint['line-color']).toBe('#123456');
    expect(paint['line-gradient']).toBeUndefined();
  });
});
