/**
 * Scenario: a section is open in 3D while its bounds are being trimmed.
 *
 * Expected behaviour: the page receives the trimmed line, the extension line
 * and the trimmed end points in one collection, and dims the full line under
 * them. Leaving trim mode sends an empty collection, which restores the full
 * line.
 */
import { buildSectionTrimCollection } from '@/features/maps/lib/sectionTrimCollection';
import { buildUpdateLayersScript, LAYER_KEYS } from '@/features/maps/lib/htmlBuilders';

const line = (coords: [number, number][]): GeoJSON.Feature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: coords },
});
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const point = (position: string, c: [number, number]): GeoJSON.Feature => ({
  type: 'Feature',
  properties: { position },
  geometry: { type: 'Point', coordinates: c },
});
const endpoints: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [point('start', [7.31, 46.21]), point('end', [7.32, 46.22])],
};

describe('buildSectionTrimCollection', () => {
  it('is empty when no trim is active', () => {
    const out = buildSectionTrimCollection({
      trimRange: null,
      trimmed: line([
        [7.3, 46.2],
        [7.31, 46.21],
      ]),
      extension: empty,
      endpoints,
    });
    expect(out.features).toHaveLength(0);
  });

  it('tags the trimmed line and the trimmed end points', () => {
    const out = buildSectionTrimCollection({
      trimRange: { start: 1, end: 2 },
      trimmed: line([
        [7.31, 46.21],
        [7.32, 46.22],
      ]),
      extension: empty,
      endpoints,
    });
    expect(out.features.map((f) => f.properties?.kind)).toEqual(['trimmed', 'start', 'end']);
  });

  it('carries the extension line in expand mode', () => {
    const out = buildSectionTrimCollection({
      trimRange: { start: 0, end: 3 },
      trimmed: line([
        [7.3, 46.2],
        [7.32, 46.22],
      ]),
      extension: line([
        [7.29, 46.19],
        [7.33, 46.23],
      ]),
      endpoints,
    });
    expect(out.features.map((f) => f.properties?.kind)).toContain('extension');
  });

  it('skips an empty trimmed line without dropping the end points', () => {
    const out = buildSectionTrimCollection({
      trimRange: { start: 0, end: 0 },
      trimmed: empty,
      extension: empty,
      endpoints,
    });
    expect(out.features.map((f) => f.properties?.kind)).toEqual(['start', 'end']);
  });
});

describe('the 3D page patch for a trim', () => {
  it('lists the trim as its own collection', () => {
    expect(LAYER_KEYS).toContain('sectionTrimGeoJSON');
  });

  it('sends the trim alone and leaves the other layers unchanged', () => {
    const trim = buildSectionTrimCollection({
      trimRange: { start: 1, end: 2 },
      trimmed: line([
        [7.31, 46.21],
        [7.32, 46.22],
      ]),
      extension: empty,
      endpoints,
    });
    const script = buildUpdateLayersScript({ sectionTrimGeoJSON: trim });
    expect(script).toContain('"kind":"trimmed"');
    expect(script).toContain('const tracesData = undefined;');
  });

  it('dims the full line while the trim is drawn and restores it after', () => {
    const script = buildUpdateLayersScript({ sectionTrimGeoJSON: empty });
    expect(script).toContain('const sectionTrimData = {"type":"FeatureCollection","features":[]};');
    expect(script).toContain("setPaintProperty('route-line', 'line-opacity'");
    expect(script).toContain("'start-end-fill'");
  });
});
