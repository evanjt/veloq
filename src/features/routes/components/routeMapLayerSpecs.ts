/**
 * Source and layer specs for the inline route map.
 */
import type { MapPalette } from '@/theme';
import {
  boundsOfLngLat,
  buildDeltaGapLayer,
  buildEndpointLayers,
  DELTA_GAPS_SOURCE_ID,
  ENDPOINT_IMAGES,
  lineBandExpression,
  type LineBand,
  type LngLat,
  type MapLayerSpec,
  type MapSourceSpec,
  type MapSubjectSpecs,
} from '@/features/maps';

/** Room around the route's own line for traces that stray outside it, as a fraction of its span. */
export const ROUTE_MAP_BOUNDS_PADDING = 0.1;

export interface RouteMapSpecInput {
  /** The route's representative line, as points and as the collection drawn. */
  routeCoords: readonly LngLat[];
  routeLine: GeoJSON.FeatureCollection;
  /** Every attempt's trace, each carrying its activity id. */
  fadedTraces: GeoJSON.FeatureCollection;
  /** The picked attempt or lap, drawn over the rest. */
  highlightedTrace: GeoJSON.FeatureCollection;
  endpoints: GeoJSON.FeatureCollection;
  /** The stretches of the route line the shown attempt has no data for. */
  deltaGaps: GeoJSON.FeatureCollection;
  palette: MapPalette;
  /** Hides the highlighted attempt from the faded layer. */
  fadedFilter: unknown[] | undefined;
  /** An attempt is picked, so the route itself is context. */
  routeContext: boolean;
  deltaBands: readonly LineBand[] | null;
}

/** Everything a route's map draws, and the extent it fits. */
export function routeMapSpecs(input: RouteMapSpecInput): MapSubjectSpecs {
  return {
    sources: buildRouteSources(
      {
        'faded-traces': { kind: 'geojson', data: input.fadedTraces },
        'highlighted-trace': { kind: 'geojson', data: input.highlightedTrace },
        endpoints: { kind: 'geojson', data: input.endpoints },
        [DELTA_GAPS_SOURCE_ID]: { kind: 'geojson', data: input.deltaGaps },
      },
      input.routeLine
    ),
    layers: buildRouteLayers({
      palette: input.palette,
      routeContext: input.routeContext,
      fadedFilter: input.fadedFilter,
      includeRoute: true,
      deltaBands: input.deltaBands,
    }),
    images: ENDPOINT_IMAGES,
    interactiveLayers: undefined,
    bounds: boundsOfLngLat(input.routeCoords, ROUTE_MAP_BOUNDS_PADDING),
  };
}

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
  deltaBands = null,
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
   * The bands of the route line by how far ahead or behind the shown attempt
   * is, while the chart shows the delta plot. Without them the line is the
   * base's route colour.
   */
  deltaBands?: readonly LineBand[] | null;
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
            ...(deltaBands
              ? { 'line-gradient': lineBandExpression(deltaBands, palette) }
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
    buildDeltaGapLayer(palette, 4),
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
