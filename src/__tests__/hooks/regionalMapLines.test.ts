/**
 * Scenario: the map no longer draws one line per visible activity, nor a second
 * point per activity.
 *
 * Expected behaviour: the hook builds one point per activity, the marker, and neither a
 * start-point collection nor a per-activity trace collection beside it.
 */
import { renderHook } from '@testing-library/react-native';
import { useMapGeoJSON } from '@/features/maps/components/regional/useMapGeoJSON';

function buildArgs(): Parameters<typeof useMapGeoJSON>[0] {
  return {
    allActivities: [],
    activityCenters: {},
    userLocation: null,
    selected: null,
    isDark: false,
  };
}

describe('the lines the map still paints', () => {
  it('builds no start-point collection beside the markers', async () => {
    const { result } = await renderHook(() => useMapGeoJSON(buildArgs()));

    expect('startPointsGeoJSON' in result.current).toBe(false);
  });

  it('builds no per-activity trace collection at all', async () => {
    const { result } = await renderHook(() => useMapGeoJSON(buildArgs()));

    expect('tracesGeoJSON' in result.current).toBe(false);
  });

  it('builds no route group collections: the engine reads them', async () => {
    const { result } = await renderHook(() => useMapGeoJSON(buildArgs()));

    expect('routesGeoJSON' in result.current).toBe(false);
    expect('routeMarkersGeoJSON' in result.current).toBe(false);
  });
});
