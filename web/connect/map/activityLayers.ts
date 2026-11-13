// What the activity page's map slot draws and moves: the track's positions, the
// marker the chart's crosshair puts on the line, the engine's overlay split into
// the sources the phone's layers read, and the spec those layers make. Pure, so
// a test drives it without a renderer.

import type { MapSurfaceSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';
import {
  activityMapSpecs,
  type ActivityLayerInput,
} from '@/features/maps/components/activityMapLayerSpecs';
import { EMPTY_FEATURE_COLLECTION } from '@/features/maps/lib/coordinates';

import { pagePalette, type PageBase } from './style';

export type LngLat = [number, number];

/** Colours of the compared tracks, by the class `compareColour` names; the table's own. */
export const COMPARE_COLOURS: Readonly<Record<string, string>> = {
  'line-0': '#d1495b',
  'line-1': '#00798c',
  'line-2': '#edae49',
  'line-3': '#66a182',
};

const NO_FEATURES: GeoJSON.FeatureCollection = EMPTY_FEATURE_COLLECTION;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * The positions of a track as the engine writes it, the i-th being the stream's
 * i-th point, which is the index the chart's crosshair carries. Text that is not
 * a track reads as no positions.
 */
export function trackPositions(text: string): LngLat[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const features = (parsed as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const geometry = (features[0] as { geometry?: { type?: unknown; coordinates?: unknown } })
    ?.geometry;
  if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return [];
  return geometry.coordinates.flatMap((position: unknown) =>
    Array.isArray(position) && finite(position[0]) && finite(position[1])
      ? [[position[0], position[1]] as LngLat]
      : []
  );
}

/** The position at a stream index, which clamps at both ends; null on an empty track. */
export function positionAt(positions: readonly LngLat[], index: number): LngLat | null {
  if (positions.length === 0 || Number.isNaN(index)) return null;
  const at = Math.min(positions.length - 1, Math.max(0, Math.floor(index)));
  return positions[at] ?? null;
}

/** The index of the position nearest a point, for a pointer over the line; null on an empty track. */
export function nearestIndex(positions: readonly LngLat[], point: LngLat): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  const scale = Math.cos((point[1] * Math.PI) / 180);
  positions.forEach(([lng, lat], at) => {
    const distance = ((lng - point[0]) * scale) ** 2 + (lat - point[1]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = at;
    }
  });
  return best;
}

/** The marker source's data: a point at the stream index, none when the crosshair is off. */
export function crosshairData(
  positions: readonly LngLat[],
  index: number | null
): GeoJSON.Feature<GeoJSON.Point> | null {
  const at = index === null ? null : positionAt(positions, index);
  return at
    ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: at } }
    : null;
}

/** The overlay text split into the sources the phone's layers read. */
export type Overlay = {
  sections: GeoJSON.FeatureCollection;
  portions: GeoJSON.FeatureCollection;
  markers: GeoJSON.FeatureCollection;
};

export const NO_OVERLAY: Overlay = {
  sections: NO_FEATURES,
  portions: NO_FEATURES,
  markers: NO_FEATURES,
};

export function splitOverlay(text: string): Overlay {
  let features: GeoJSON.Feature[];
  try {
    features = (JSON.parse(text) as GeoJSON.FeatureCollection).features ?? [];
  } catch {
    return NO_OVERLAY;
  }
  const of = (kind: string): GeoJSON.FeatureCollection => {
    const kept = features.filter((feature) => feature.properties?.kind === kind);
    return kept.length ? { type: 'FeatureCollection', features: kept } : NO_FEATURES;
  };
  return { sections: of('section'), portions: of('portion'), markers: of('pr') };
}

/** The ids of the sections the overlay draws, in the order it draws them. */
export function overlaySectionIds(overlay: Overlay): string[] {
  return overlay.sections.features.map((feature) => String(feature.properties?.id));
}

/** Where a track's source reads from: the revision is the detail read's stamp. */
export const trackUrl = (id: string, revision: number | string) =>
  `veloq://geo/track/${encodeURIComponent(id)}?v=${revision}`;

export const overlayUrl = (id: string) => `veloq://geo/activity-overlay/${encodeURIComponent(id)}`;

export type ActivityMapInput = {
  base: PageBase;
  activityId: string;
  revision: number | string;
  overlay: Overlay;
  /** The marker's point, or null while the crosshair is off. */
  crosshair: GeoJSON.Feature<GeoJSON.Point> | null;
  highlightedSectionId: string | null;
  /** Other tracks drawn over this one, each in its colour class. */
  compare: readonly { id: string; colour: string }[];
};

const HIGHLIGHT_PLACEHOLDER: GeoJSON.Feature<GeoJSON.Point> = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'Point', coordinates: [0, 0] },
};

/** The layer input the phone's `buildActivityLayers` is given for these facts. */
export function layerInput(input: ActivityMapInput): ActivityLayerInput {
  return {
    palette: pagePalette(input.base),
    overlayHasData: input.overlay.sections.features.length > 0,
    gradientActive: false,
    gradientLineExpression: null,
    hasSectionOverlays: input.overlay.portions.features.length > 0,
    highlightedSectionId: input.highlightedSectionId,
    hasHighlightPoint: input.crosshair !== null,
    creationMode: false,
    hasUserLocation: false,
  };
}

/** The spec the slot draws: the phone's sources and layers, then the compared tracks over them. */
export function activityMapSpec(input: ActivityMapInput): MapSurfaceSpec {
  const specs = activityMapSpecs({
    sources: {
      routeGeoJSON: trackUrl(input.activityId, input.revision),
      overlayGeoJSON: input.overlay.sections,
      consolidatedPortionsGeoJSON: input.overlay.portions,
      sectionMarkersGeoJSON: input.overlay.markers,
      highlightGeoJSON: input.crosshair ?? HIGHLIGHT_PLACEHOLDER,
      endpointsGeoJSON: NO_FEATURES,
      sectionCreationLine: NO_FEATURES,
      sectionCreationMarkers: NO_FEATURES,
      userLocationGeoJSON: NO_FEATURES,
    },
    layers: layerInput(input),
    coordinates: [],
  });
  const sources: MapSurfaceSpec['sources'] = { ...specs.sources };
  const layers = [...specs.layers];
  for (const { id, colour } of input.compare) {
    const source = `compare-${id}`;
    sources[source] = { kind: 'geojson', data: trackUrl(id, 0) };
    layers.push({
      id: source,
      type: 'line',
      source,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': COMPARE_COLOURS[colour] ?? '#888888', 'line-width': 3 },
    });
  }
  return {
    sources,
    layers,
    images: specs.images,
    interactiveLayers: [
      'portion-line',
      'overlay-line',
      'route-line',
      ...(specs.interactiveLayers ?? []),
    ],
  };
}

/** The bounds of positions as `[[west, south], [east, north]]`, or null when there are none. */
export function boundsOf(
  tracks: readonly (readonly LngLat[])[]
): [[number, number], [number, number]] | null {
  const all = tracks.flat();
  if (all.length === 0) return null;
  return [
    [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1]))],
    [Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))],
  ];
}
