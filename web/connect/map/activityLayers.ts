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
import {
  buildBandedLineStops,
  buildGradientLineStops,
  gradientStepExpression,
} from '@/features/maps/lib/gradientLineColor';
import { BUNDLED_TEXT_FONT } from '@/features/maps/lib/bundledGlyphs';
import { divergingStep } from '@/features/maps/lib/divergingStep';

import type { QueryClient } from '../query';
import { mapPalette, zoneColour } from '../theme';
import { pagePalette, toneOf, type PageBase } from './style';

export type LngLat = [number, number];

/** Colours of the compared tracks, by the class `compareColour` names; the table's own. */
export const COMPARE_COLOURS: Readonly<Record<string, string>> = {
  'line-0': '#d1495b',
  'line-1': '#00798c',
  'line-2': '#edae49',
  'line-3': '#66a182',
};

/** The colour of the line a brush on the charts covers. */
const BRUSH_COLOUR = '#ff7a00';

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

/** The text of a `geo.*` answer, or an empty string when the phone sends none. */
export async function geoText(
  queries: QueryClient,
  method: string,
  activityId: string
): Promise<string> {
  const answer = (await queries.fetch(method, { id: activityId })) as { text?: unknown } | null;
  return typeof answer?.text === 'string' ? answer.text : '';
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

/**
 * The stretch of the track a brush covers, as one line from the first to the
 * last sample; empty for no range, an empty track, a range off the track, or a
 * single sample. A range past the end is clamped to it.
 */
export function rangeLine(
  positions: readonly LngLat[],
  range: { from: number; to: number } | null
): GeoJSON.FeatureCollection {
  if (!range || positions.length === 0) return NO_FEATURES;
  const from = Math.max(0, Math.floor(range.from));
  const to = Math.min(positions.length - 1, Math.floor(range.to));
  if (!(from < to)) return NO_FEATURES;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: positions.slice(from, to + 1) as LngLat[] },
      },
    ],
  };
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

/**
 * The line through the positions a brush on the charts covers, the range's
 * ends clamped to the track; none without a range or with fewer than two
 * positions in it.
 */
export function rangeData(
  positions: readonly LngLat[],
  range: { from: number; to: number } | null
): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (!range || positions.length === 0) return null;
  const from = Math.max(0, Math.floor(range.from));
  const to = Math.min(positions.length - 1, Math.floor(range.to));
  if (to <= from) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: positions.slice(from, to + 1) as LngLat[] },
  };
}

/** The start and end of the track as the phone's endpoint layers read them; one point for a single position, none for an empty track. */
export function endpointsData(positions: readonly LngLat[]): GeoJSON.FeatureCollection {
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (!first || !last) return NO_FEATURES;
  const at = (position: LngLat, which: 'start' | 'end'): GeoJSON.Feature => ({
    type: 'Feature',
    properties: { position: which },
    geometry: { type: 'Point', coordinates: position },
  });
  return {
    type: 'FeatureCollection',
    features: positions.length > 1 ? [at(first, 'start'), at(last, 'end')] : [at(first, 'start')],
  };
}

/**
 * The `line-gradient` expression colouring the track by grade in the phone's
 * seven steps, each stop placed by its share of the distance stream. Null with
 * fewer than two grade samples.
 */
export function gradeLine(
  grade: readonly number[],
  distance: readonly number[],
  base: PageBase
): unknown[] | null {
  const stops = buildGradientLineStops(grade, distance, base);
  return stops ? gradientStepExpression(stops) : null;
}

/** One band of a heart rate or power zone ladder: its zone number and its upper edge, absent for the open top zone. */
export type ZoneEdge = { zone: number; upper: number | null };

/** What the track is coloured by, with the stream's samples and the distance that places them. */
export type TrackColour =
  | { stream: 'grade' | 'speed'; values: readonly number[]; distance: readonly number[] }
  | {
      stream: 'power' | 'heartrate';
      values: readonly number[];
      distance: readonly number[];
      zones?: readonly ZoneEdge[];
    };

const stepsOf = (stops: (string | number)[] | null) =>
  stops ? gradientStepExpression(stops) : null;

/**
 * The `line-gradient` expression colouring the track by a heart rate or power
 * zone ladder: each sample takes the colour of the first band whose upper edge
 * it does not pass, so a ride crossing three bands has three steps. A sample
 * with no value takes the lowest band. Null without bands or two samples.
 */
export function zoneLine(
  values: readonly number[],
  distance: readonly number[],
  zones: readonly ZoneEdge[],
  base: PageBase
): unknown[] | null {
  if (zones.length === 0) return null;
  const dark = toneOf(base) === 'dark';
  const colourOf = (value: number) => {
    const band = Number.isFinite(value)
      ? (zones.find((zone) => zone.upper === null || value <= zone.upper) ??
        zones[zones.length - 1])
      : zones[0];
    return zoneColour(band?.zone ?? 1, dark);
  };
  return stepsOf(buildBandedLineStops(values, distance, colourOf));
}

/**
 * The `line-gradient` expression colouring the track by speed against the
 * ride's own mean, in the base map's pace steps: faster on the cool side.
 * Null without a positive mean or two samples.
 */
export function speedLine(
  values: readonly number[],
  distance: readonly number[],
  base: PageBase
): unknown[] | null {
  const finiteValues = values.filter(Number.isFinite);
  const mean = finiteValues.reduce((sum, value) => sum + value, 0) / (finiteValues.length || 1);
  if (!(mean > 0)) return null;
  const ramp = mapPalette(base).div;
  const colourOf = (value: number) =>
    ramp[divergingStep(((mean - value) / mean) * 100, 'pace') ?? 'mid'];
  return stepsOf(buildBandedLineStops(values, distance, colourOf));
}

/** The expression for the chosen colouring; null when the stream cannot band the line. */
export function trackLine(colour: TrackColour, base: PageBase): unknown[] | null {
  switch (colour.stream) {
    case 'grade':
      return gradeLine(colour.values, colour.distance, base);
    case 'speed':
      return speedLine(colour.values, colour.distance, base);
    default:
      return zoneLine(colour.values, colour.distance, colour.zones ?? [], base);
  }
}

/**
 * The number each section carries, from 1 in the order the track first meets
 * it; a section met twice keeps its first number.
 */
export function numberSections(ids: readonly string[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const id of ids) if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
  return numbers;
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
  const numbers = numberSections(
    features.filter((f) => f.properties?.kind === 'section').map((f) => String(f.properties?.id))
  );
  const numbered = (collection: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection => ({
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        number: String(numbers.get(String(feature.properties?.id)) ?? ''),
      },
    })),
  });
  return { sections: numbered(of('section')), portions: of('portion'), markers: of('pr') };
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
  /** The stretch of the track a chart brush covers, from `rangeLine`. */
  range?: GeoJSON.FeatureCollection;
  /** The start and end points, from `endpointsData`. */
  endpoints?: GeoJSON.FeatureCollection;
  /** A `line-gradient` expression over `line-progress`, from `gradeLine`; the solid line without one. */
  gradient?: unknown[] | null;
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
    gradientActive: input.gradient != null,
    gradientLineExpression: input.gradient ?? null,
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
      endpointsGeoJSON: input.endpoints ?? NO_FEATURES,
      sectionCreationLine: NO_FEATURES,
      sectionCreationMarkers: NO_FEATURES,
      userLocationGeoJSON: NO_FEATURES,
    },
    layers: layerInput(input),
    coordinates: [],
  });
  const sources: MapSurfaceSpec['sources'] = { ...specs.sources };
  const layers = [...specs.layers];
  layers.push({
    id: 'section-number',
    type: 'symbol',
    source: 'overlay',
    layout: {
      'symbol-placement': 'line-center',
      'text-field': ['get', 'number'],
      'text-font': BUNDLED_TEXT_FONT,
      'text-size': 12,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': pagePalette(input.base).route,
      'text-halo-color': pagePalette(input.base).casing,
      'text-halo-width': 2,
    },
  });
  sources['range'] = { kind: 'geojson', data: input.range ?? NO_FEATURES };
  layers.push({
    id: 'range-line',
    type: 'line',
    source: 'range',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': pagePalette(input.base).record, 'line-width': 6 },
  });
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
  if (input.range && input.range.features.length > 0) {
    sources['brush-range'] = { kind: 'geojson', data: input.range };
    layers.push({
      id: 'brush-range',
      type: 'line',
      source: 'brush-range',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': BRUSH_COLOUR, 'line-width': 6 },
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
