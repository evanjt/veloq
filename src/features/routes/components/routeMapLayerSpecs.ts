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
 * Layer stack, back to front: other attempts in the muted colour, then the route, then
 * whatever the caller singled out, then the endpoint dots.
 */
export function buildRouteLayers({
  palette,
  routeContext,
  fadedFilter,
  includeRoute,
  deltaLineStops = null,
}: {
  /** The colours of the base map drawn under the layers. */
  palette: MapPalette;
  /** An attempt is picked, so the route itself is context and takes the muted colour. */
  routeContext: boolean;
  /** Hides the highlighted attempt from the faded layer. */
  fadedFilter: unknown[] | undefined;
  /** Off in fullscreen, where the shell draws the route itself. */
  includeRoute: boolean;
  /**
   * `line-progress` stops colouring the route line by time won or lost, while
   * the chart shows the delta plot. Without them the line is the base's route colour.
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
            'line-color': palette.casing,
            // Context lines carry no casing.
            'line-opacity': routeContext ? 0 : 1,
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
              : { 'line-color': routeContext ? palette.muted : palette.route }),
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
        'line-color': palette.muted,
        'line-width': 2,
      },
    },
    ...routeLayers,
    {
      id: 'highlighted-casing',
      type: 'line',
      source: 'highlighted-trace',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.casing, 'line-width': 5 },
    },
    {
      id: 'highlighted-line',
      type: 'line',
      source: 'highlighted-trace',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.ink, 'line-width': 4 },
    },
    ...buildEndpointLayers(palette),
  ];
}
