import {
  buildSectionLayers,
  buildSectionSources,
} from '@/features/routes/components/sectionMapLayerSpecs';
import { deltaLineBands, type LineBand } from '@/features/maps/lib/deltaLineColor';
import { mapPalette } from '@/theme';

const palette = mapPalette('light');

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;
const input = (deltaBands: LineBand[] | null, showExtensionAndSection = true) =>
  ({
    palette,
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
    showExtensionAndSection,
    trimCasingWidth: 5,
    trimLineWidth: 4,
    traceCasingWidth: 5,
    traceLineWidth: 4,
    deltaBands,
    deltaGapsGeoJSON: empty,
  }) as unknown as Parameters<typeof buildSectionLayers>[0];

const sectionLine = (bands: LineBand[] | null) =>
  buildSectionLayers(input(bands)).find((l) => l.id === 'section-line')!;

describe('section map delta line', () => {
  it('declares the section source with line metrics, and the gaps source, in every mode', () => {
    for (const bands of [null, deltaLineBands([1, NaN], 100, 200, 'forward')]) {
      const sources = buildSectionSources(input(bands));
      expect(sources.section).toMatchObject({ lineMetrics: true });
      expect(sources['delta-gaps']).toEqual({ kind: 'geojson', data: empty });
    }
  });

  it('steps the line over line-progress in the base ramp while it is banded', () => {
    const bands = deltaLineBands([7, 0.5], 100, 200, 'forward');
    const paint = sectionLine(bands).paint as Record<string, unknown>;
    expect(paint['line-gradient']).toEqual([
      'step',
      ['line-progress'],
      palette.div['warm-3'],
      0.5,
      palette.div.mid,
    ]);
    expect(paint['line-color']).toBeUndefined();
  });

  it('keeps the flat colour when nothing is banded', () => {
    const paint = sectionLine(null).paint as Record<string, unknown>;
    expect(paint['line-color']).toBe(palette.route);
    expect(paint['line-gradient']).toBeUndefined();
  });

  it('dashes the stretches with no data inline and on the fullscreen map', () => {
    for (const mode of [true, false]) {
      const gap = buildSectionLayers(input(null, mode)).find((l) => l.id === 'delta-gap-line')!;
      expect(gap.source).toBe('delta-gaps');
      expect(gap.paint).toMatchObject({ 'line-color': palette.muted, 'line-dasharray': [2, 2] });
    }
  });
});
