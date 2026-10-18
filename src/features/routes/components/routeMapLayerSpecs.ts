/**
 * Source and layer specs for the inline route map.
 */
import type { MapPalette } from '@/theme';
import { buildEndpointLayers, type MapLayerSpec, type MapSourceSpec } from '@/features/maps';

/**
 * The inline map's sources: the overlays and the route itself. line-gradient
 * addresses the route by line-progress, which needs line metrics.
 */
export function buildRouteSources(
  overlaySources: Record<string, MapSourceSpec>,
  routeLine: GeoJSON.FeatureCollection
): Record<string, MapSourceSpec> {
  return { ...overlaySources, route: { kind: 'geojson', data: routeLine, lineMetrics: true } };
}

/**
 * Layer stack, back to front: other attempts, then the representative route, then
 * whatever the caller singled out, then the endpoint dots.
 */
export function buildRouteLayers({
  palette,
  activityColor,
  representativeOpacity,
  fadedOpacity,
  fadedFilter,
  includeRoute,
  deltaLineStops = null,
}: {
  /** The colours of the base map drawn under the layers. */
  palette: MapPalette;
  activityColor: string;
  representativeOpacity: number;
  fadedOpacity: number;
  /** Hides the highlighted attempt from the faded layer. */
  fadedFilter: unknown[] | undefined;
  /** Off in fullscreen, where the shell draws the route itself. */
  includeRoute: boolean;
  /**
   * `line-progress` stops colouring the route line by time won or lost, while
   * the chart shows the delta plot. Without them the line keeps `activityColor`.
   */
  deltaLineStops?: (string | number)[] | null;
}): MapLayerSpec[] {
  const routeLayers: MapLayerSpec[] = includeRoute
    ? [
        {
          id: 'route-casing',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': palette.layer.casing,
            'line-opacity': representativeOpacity,
            'line-width': 5,
          },
        },
        {
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            ...(deltaLineStops
              ? {
                  'line-gradient': [
                    'interpolate',
                    ['linear'],
                    ['line-progress'],
                    ...deltaLineStops,
                  ],
                }
              : { 'line-color': activityColor }),
            'line-opacity': representativeOpacity,
            'line-width': 4,
          },
        },
      ]
    : [];

  return [
    {
      id: 'faded-traces-line',
      type: 'line',
      source: 'faded-traces',
      filter: fadedFilter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': activityColor,
        'line-opacity': fadedOpacity,
        'line-width': 2,
      },
    },
    ...routeLayers,
    {
      id: 'highlighted-casing',
      type: 'line',
      source: 'highlighted-trace',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.layer.casing, 'line-width': 5 },
    },
    {
      id: 'highlighted-line',
      type: 'line',
      source: 'highlighted-trace',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.layer.trace, 'line-width': 4 },
    },
    ...buildEndpointLayers(palette),
  ];
}
