/**
 * Scenario: the charts tab shows only the PR sections on the activity map, and
 * the athlete scrubs the chart there, which re-renders the map every tick.
 *
 * Expected behaviour: the map chooses the PR sections itself, from the stable
 * overlay list, so a scrub rebuilds none of the section sources.
 */

import { renderHook } from '@testing-library/react-native';
import { useMapLayers } from '@/features/maps/hooks/useMapLayers';
import type { SectionOverlay } from '@/features/maps/components/ActivityMapView';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const track = Array.from({ length: 12 }, (_, i) => ({
  latitude: 46.948 + i * 0.001,
  longitude: 7.447 + i * 0.001,
}));

const overlays: SectionOverlay[] = [
  { id: 'pr', sectionPolyline: track.slice(1, 5), activityPortion: track.slice(1, 5), isPR: true },
  { id: 'plain', sectionPolyline: track.slice(6, 10), activityPortion: track.slice(6, 10) },
];

const useLayers = (activeTab: string, highlightIndex: number | null) =>
  useMapLayers({
    validCoordinates: track,
    coordinates: track,
    sectionOverlays: overlays,
    highlightIndex,
    activeTab,
  });

const sectionIds = (collection: GeoJSON.FeatureCollection) => [
  ...new Set(collection.features.map((f) => f.properties?.id ?? f.properties?.sectionId)),
];

it('draws only the PR sections on the charts tab', () => {
  const { result } = renderHook(() => useLayers('charts', null));

  expect(sectionIds(result.current.consolidatedPortionsGeoJSON)).toEqual(['pr']);
  expect(sectionIds(result.current.sectionBoundariesGeoJSON)).toEqual(['pr']);
  expect(sectionIds(result.current.sectionMarkersGeoJSON)).toEqual(['pr']);
});

it('draws every section on the sections tab', () => {
  const { result } = renderHook(() => useLayers('sections', null));

  expect(sectionIds(result.current.consolidatedPortionsGeoJSON)).toEqual(['pr', 'plain']);
});

it('keeps every section source across a scrub on the charts tab', () => {
  const { result, rerender } = renderHook(
    ({ index }: { index: number | null }) => useLayers('charts', index),
    { initialProps: { index: 0 } }
  );
  const first = result.current;

  for (const index of [1, 2, 3]) rerender({ index });

  expect(result.current.consolidatedPortionsGeoJSON).toBe(first.consolidatedPortionsGeoJSON);
  expect(result.current.sectionBoundariesGeoJSON).toBe(first.sectionBoundariesGeoJSON);
  expect(result.current.sectionMarkersGeoJSON).toBe(first.sectionMarkersGeoJSON);
  expect(result.current.highlightPoint).not.toBe(first.highlightPoint);
});
