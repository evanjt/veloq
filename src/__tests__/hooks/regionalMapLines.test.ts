/**
 * Scenario: the map no longer draws one line per visible activity. What is left
 * reading a signature is the start point of each activity and the route line a
 * route group paints. The tracks arrive as flat `[lat, lng, ...]` pairs,
 * because a point that was an object cost 56 ms a rebuild under Hermes.
 *
 * Expected behaviour: a route line keeps every point it was recorded with,
 * `[lng, lat]` in GeoJSON order, non-finite pairs left out, and a track with
 * fewer than two drawable points dropped rather than handed to the renderer,
 * which crashes on iOS over one. A start point is the first drawable pair.
 */
import { renderHook } from '@testing-library/react-native';
import { useMapGeoJSON } from '@/features/maps/components/regional/useMapGeoJSON';
import type { RouteSignature } from '@/features/routes/hooks';

jest.mock('@/features/maps/components/ActivityTypeFilter', () => ({
  getActivityTypeConfig: () => ({ color: '#3B82F6', icon: 'bike', label: 'Ride' }),
}));

const t = ((key: string) => key) as unknown as Parameters<typeof useMapGeoJSON>[0]['t'];

/** A track, as the flat pairs the signature read now answers with. */
function signature(pairs: number[]): RouteSignature {
  return { points: Float64Array.from(pairs), center: { lat: pairs[0], lng: pairs[1] } };
}

function activity(id: string, startPoint?: [number, number]) {
  return { id, type: 'Ride', name: id, date: 0, startPoint } as unknown as Parameters<
    typeof useMapGeoJSON
  >[0]['traceActivities'][number];
}

/** The start points the hook builds for activities carrying their own start. */
function startPoints(items: ReturnType<typeof activity>[]) {
  const { result } = renderHook(() =>
    useMapGeoJSON({
      allActivities: [],
      traceActivities: items,
      activityCenters: {},
      sections: [],
      routeGroups: [],
      showRoutes: false,
      userLocation: null,
      selected: null,
      t,
    })
  );
  return result.current.startPointsGeoJSON.features;
}

function buildArgs(
  routeSignatures: Record<string, RouteSignature>,
  { asRoutes = false }: { asRoutes?: boolean } = {}
): Parameters<typeof useMapGeoJSON>[0] {
  const ids = Object.keys(routeSignatures);
  return {
    allActivities: [],
    traceActivities: ids.map((id) => activity(id)),
    activityCenters: {},
    routeSignatures,
    sections: [],
    routeGroups: asRoutes
      ? ids.map(
          (id) =>
            ({ representativeId: id, activityIds: [id], name: id }) as unknown as Parameters<
              typeof useMapGeoJSON
            >[0]['routeGroups'][number]
        )
      : [],
    showRoutes: asRoutes,
    userLocation: null,
    selected: null,
    t,
  };
}

/** The first route line the hook builds, as GeoJSON coordinates. */
function routeLine(signatures: Record<string, RouteSignature>) {
  const { result } = renderHook(() => useMapGeoJSON(buildArgs(signatures, { asRoutes: true })));
  const collection = result.current.routesGeoJSON as GeoJSON.FeatureCollection;
  return collection.features;
}

describe('the lines the map still paints', () => {
  it('keeps every point of a route line, in GeoJSON order', () => {
    const [feature] = routeLine({
      a1: signature([46.5, 6.6, 46.51, 6.61, 46.52, 6.62, 46.53, 6.63, 46.54, 6.64]),
    });

    expect(feature.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [6.6, 46.5],
        [6.61, 46.51],
        [6.62, 46.52],
        [6.63, 46.53],
        [6.64, 46.54],
      ],
    });
  });

  it('leaves a non-finite pair out rather than handing it to the renderer', () => {
    const [feature] = routeLine({
      a1: signature([46.5, 6.6, 46.51, 6.61, NaN, 6.62, 46.53, 6.63]),
    });

    expect((feature.geometry as GeoJSON.LineString).coordinates).toEqual([
      [6.6, 46.5],
      [6.61, 46.51],
      [6.63, 46.53],
    ]);
  });

  it('drops a track with fewer than two drawable points', () => {
    expect(routeLine({ a1: signature([46.5, 6.6, Infinity, 6.61]) })).toEqual([]);
  });

  it('answers an empty collection rather than null, so the source stays mounted', () => {
    const { result } = renderHook(() => useMapGeoJSON(buildArgs({})));

    expect(result.current.startPointsGeoJSON).toEqual({
      type: 'FeatureCollection',
      features: [],
    });
  });

  it('asks for no signature to draw what the regional map draws', () => {
    const { result } = renderHook(() =>
      useMapGeoJSON({
        allActivities: [],
        traceActivities: [activity('a1', [6.6, 46.5])],
        activityCenters: {},
        sections: [],
        routeGroups: [],
        showRoutes: false,
        userLocation: null,
        selected: null,
        t,
      })
    );

    expect(result.current.startPointsGeoJSON.features).toHaveLength(1);
  });

  it('marks a start from the activity itself, with no signature loaded', () => {
    const [feature] = startPoints([activity('a1', [6.6, 46.5])]);

    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [6.6, 46.5] });
  });

  it('leaves out an activity the engine holds no start for', () => {
    expect(startPoints([activity('a1')])).toEqual([]);
  });

  it('leaves out a non-finite start rather than handing it to the renderer', () => {
    expect(startPoints([activity('a1', [NaN, 46.5])])).toEqual([]);
  });

  it('builds no per-activity trace collection at all', () => {
    const { result } = renderHook(() =>
      useMapGeoJSON(buildArgs({ a1: signature([46.5, 6.6, 46.51, 6.61]) }))
    );

    expect('tracesGeoJSON' in result.current).toBe(false);
  });
});
