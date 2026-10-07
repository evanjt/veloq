/**
 * Scenario: the section map is in 3D while an activity row, a lap or a nearby
 * section is selected.
 *
 * Expected behaviour: the 3D collections carry what the 2D layers draw from the
 * same inputs: the highlighted activity and lap as one highlight collection,
 * the nearby sections with the id a tap reports and the selected one marked.
 */
import { buildSection3DOverlays } from '@/features/routes/components/sectionMap3DOverlays';
import type { SectionMapLayers } from '@/features/routes/components/useSectionMapLayers';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const line = (properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature => ({
  type: 'Feature',
  properties,
  geometry: {
    type: 'LineString',
    coordinates: [
      [7.3, 46.2],
      [7.31, 46.21],
    ],
  },
});

const layers = (over: Partial<SectionMapLayers> = {}): SectionMapLayers => ({
  sectionGeoJSON: EMPTY,
  trimmedGeoJSON: EMPTY,
  shadowGeoJSON: EMPTY,
  extensionGeoJSON: EMPTY,
  allTracesFeatureCollection: EMPTY,
  hasAllTraces: false,
  highlightedTraceFilter: undefined,
  highlightedTraceGeoJSON: EMPTY,
  highlightedLapGeoJSON: EMPTY,
  ...over,
});

describe('buildSection3DOverlays', () => {
  it('draws nothing highlighted when nothing is selected', () => {
    const out = buildSection3DOverlays(layers(), null);

    expect(out.highlightGeoJSON.features).toHaveLength(0);
  });

  it('draws only the highlighted activity out of the pre-loaded traces', () => {
    const out = buildSection3DOverlays(
      layers({
        hasAllTraces: true,
        allTracesFeatureCollection: {
          type: 'FeatureCollection',
          features: [line({ activityId: 'a1' }), line({ activityId: 'a2' })],
        },
      }),
      'a2'
    );

    expect(out.highlightGeoJSON.features.map((f) => f.properties?.activityId)).toEqual(['a2']);
  });

  it('draws the stored trace when no traces are pre-loaded', () => {
    const out = buildSection3DOverlays(
      layers({ highlightedTraceGeoJSON: line({ id: 'a1' }) }),
      'a1'
    );

    expect(out.highlightGeoJSON.features).toHaveLength(1);
  });

  it('adds the highlighted lap beside the activity', () => {
    const out = buildSection3DOverlays(
      layers({
        hasAllTraces: true,
        allTracesFeatureCollection: {
          type: 'FeatureCollection',
          features: [line({ activityId: 'a1' })],
        },
        highlightedLapGeoJSON: line({ id: 'highlighted-lap' }),
      }),
      'a1'
    );

    expect(out.highlightGeoJSON.features).toHaveLength(2);
  });
});
