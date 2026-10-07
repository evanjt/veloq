import { buildSectionMarkers } from '../sectionMarkers';
import { sectionRowLabels } from '@/features/activity/lib/groupSectionEncounters';

const line = (x: number): GeoJSON.Feature => ({
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [x, 0],
      [x + 0.001, 0],
      [x + 0.002, 0],
    ],
  },
});

const overlay = (id: string, x: number, isPR = false) => ({
  id,
  sectionGeo: line(x),
  portionGeo: line(x),
  isPR,
});

const group = (sectionId: string) => ({ sectionId }) as never;

describe('sectionRowLabels', () => {
  it('numbers groups from one in order', () => {
    const labels = sectionRowLabels([group('a'), group('b')]);
    expect(labels.get('a')).toBe('1');
    expect(labels.get('b')).toBe('2');
  });
  it('is empty for no groups', () => {
    expect(sectionRowLabels([]).size).toBe(0);
  });
});

describe('buildSectionMarkers', () => {
  const rows = sectionRowLabels([group('s11'), group('s2'), group('s68')]);

  it('emits one marker per section labelled from its row when both directions are crossed', () => {
    const overlays = [
      overlay('s11', 0),
      overlay('s11', 0),
      overlay('s2', 1),
      overlay('s2', 1),
      overlay('s68', 2),
    ];
    const features = buildSectionMarkers(overlays, rows, false);
    expect(features.features.map((f) => f.properties?.label)).toEqual(['1', '2', '3']);
    expect(features.features.map((f) => f.properties?.sectionId)).toEqual(['s11', 's2', 's68']);
  });

  it('keeps 1..N for single-direction activities', () => {
    const features = buildSectionMarkers(
      [overlay('s11', 0), overlay('s2', 1), overlay('s68', 2)],
      rows,
      false
    );
    expect(features.features.map((f) => f.properties?.label)).toEqual(['1', '2', '3']);
  });

  it('returns nothing for no overlays', () => {
    expect(buildSectionMarkers([], rows, false).features).toEqual([]);
  });

  it('draws no marker for a section with no row', () => {
    const features = buildSectionMarkers([overlay('orphan', 0), overlay('s2', 1)], rows, false);
    expect(features.features.map((f) => f.properties?.label)).toEqual(['2']);
  });

  it('does not let an undrawable overlay shift later labels', () => {
    const broken = { id: 's11', sectionGeo: null, portionGeo: null };
    const features = buildSectionMarkers([broken, overlay('s2', 1)], rows, false);
    expect(features.features.map((f) => f.properties?.label)).toEqual(['2']);
  });

  it('labels PR markers PR, one per PR overlay', () => {
    const features = buildSectionMarkers(
      [overlay('s11', 0, true), overlay('s2', 1, false)],
      rows,
      true
    );
    expect(features.features.map((f) => f.properties?.label)).toEqual(['PR']);
  });
});
