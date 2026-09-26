/**
 * What a map surface patch has to carry, decided without stringifying the
 * whole map.
 *
 * Two savings live here. The specs callers hand to `MapSurface` are memoised,
 * so an unchanged source arrives as the same object every render: comparing
 * the object first means a tap that only repaints one layer no longer
 * serialises every track on screen to discover nothing moved. And a line that
 * grows at its end, which is every recording in progress, ships the points it
 * gained rather than all the points it has.
 *
 * Serialisation stays as the fallback for a caller that rebuilds an equal
 * object, since re-sending one would replace the page's data for no reason.
 * `serialised` is what the saving is read from: on a memoised render it is
 * zero, and every spec counted there is one the gesture budget paid for.
 */
import type {
  MapImageSpec,
  MapLayerSpec,
  MapMarkerSpec,
  MapSourceSpec,
} from '@/features/maps/lib/htmlBuilders';

/** What was last sent for one key: the object it came from, and its bytes. */
export type SentSpec<T> = {
  spec: T;
  json: string;
};

export type SingleDiff<T> = {
  sent: SentSpec<T>;
  changed: boolean;
  serialised: number;
};

/**
 * Diff one whole spec, for the lists the page takes entire: layers, markers
 * and images. Identity first, then the bytes.
 */
export function diffSpec<T>(sent: SentSpec<T> | undefined, spec: T): SingleDiff<T> {
  if (sent && sent.spec === spec) {
    return { sent, changed: false, serialised: 0 };
  }
  const json = JSON.stringify(spec);
  return { sent: { spec, json }, changed: !sent || sent.json !== json, serialised: 1 };
}

/**
 * The coordinates of a source that is one LineString and says it grows, or
 * `null` for anything else. A collection with a second feature, a point, or a
 * clustered source is not a growing line whatever it claims.
 */
export function growingLine(spec: MapSourceSpec): GeoJSON.Position[] | null {
  if (spec.kind !== 'geojson' || !spec.growing) return null;
  const { data } = spec;
  let feature: GeoJSON.Feature;
  if (data.type === 'FeatureCollection') {
    if (data.features.length !== 1) return null;
    feature = data.features[0];
  } else {
    feature = data;
  }
  if (feature.geometry?.type !== 'LineString') return null;
  return feature.geometry.coordinates;
}

export type GrowthPlan =
  | { kind: 'append'; coordinates: GeoJSON.Position[] }
  | { kind: 'whole' }
  | { kind: 'unchanged' };

const samePoint = (a: GeoJSON.Position | undefined, b: GeoJSON.Position | undefined): boolean =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * How to get the page from `sent` points to `next` points.
 *
 * An append is only offered when the line is longer and still joins where it
 * did: the first point and the point the tail hangs off both have to match.
 * Two O(1) comparisons, so a trim, a reversal or a re-cut falls back to the
 * whole line rather than corrupting it. The points themselves are compared by
 * value because a recording rebuilds its tuples on every fix.
 */
export function planGrowth(sent: GeoJSON.Position[] | null, next: GeoJSON.Position[]): GrowthPlan {
  if (!sent || sent.length === 0) return { kind: 'whole' };
  if (next.length < sent.length) return { kind: 'whole' };
  if (!samePoint(sent[0], next[0])) return { kind: 'whole' };
  if (!samePoint(sent[sent.length - 1], next[sent.length - 1])) return { kind: 'whole' };
  if (next.length === sent.length) return { kind: 'unchanged' };
  return { kind: 'append', coordinates: next.slice(sent.length) };
}

/** What the caller wants on the map this render. */
export type SurfaceSpecs = {
  sources: Record<string, MapSourceSpec>;
  layers: MapLayerSpec[];
  markers?: MapMarkerSpec[];
  /** Absent and empty differ: the page is only told about images it has. */
  images?: MapImageSpec[];
  interactiveLayers?: string[];
};

export type SurfacePatch = {
  sources?: Record<string, MapSourceSpec | null>;
  appends?: Record<string, GeoJSON.Position[]>;
  layers?: MapLayerSpec[];
  markers?: MapMarkerSpec[];
  images?: MapImageSpec[];
  interactiveLayers?: string[];
};

export type PatchResult = {
  patch: SurfacePatch | null;
  serialised: number;
};

/** What the page holds for one source. */
type SentSource = {
  spec: MapSourceSpec;
  json: string | null;
  /** The points the page has, for a growing line. */
  line: GeoJSON.Position[] | null;
};

/** Stands in for an absent list, so an absent one keeps its identity too. */
const EMPTY: never[] = [];

/**
 * Holds what the page has been told and works out the next patch from it.
 *
 * Kept out of the component so the decision can be exercised on its own: the
 * component only injects what this returns. `forget` is for a page that has
 * reloaded and holds nothing.
 */
export function createSurfacePatcher() {
  let sentSources: Record<string, SentSource> = {};
  let sentLayers: SentSpec<MapLayerSpec[]> | undefined;
  let sentMarkers: SentSpec<MapMarkerSpec[]> | undefined;
  let sentImages: SentSpec<MapImageSpec[]> | undefined;

  return {
    forget() {
      sentSources = {};
      sentLayers = undefined;
      sentMarkers = undefined;
      sentImages = undefined;
    },

    next(specs: SurfaceSpecs): PatchResult {
      const changed: Record<string, MapSourceSpec | null> = {};
      const appends: Record<string, GeoJSON.Position[]> = {};
      const nextSources: Record<string, SentSource> = {};
      let hasSourceChange = false;
      let hasAppend = false;
      let serialised = 0;

      for (const [id, spec] of Object.entries(specs.sources)) {
        const prior = sentSources[id];
        if (prior && prior.spec === spec) {
          nextSources[id] = prior;
          continue;
        }

        const line = growingLine(spec);
        if (line) {
          // A growing line is never serialised: the plan is decided from the
          // points, and that is the whole point of the flag.
          const plan = planGrowth(prior?.line ?? null, line);
          nextSources[id] = { spec, json: null, line };
          if (plan.kind === 'append') {
            appends[id] = plan.coordinates;
            hasAppend = true;
          } else if (plan.kind === 'whole') {
            changed[id] = spec;
            hasSourceChange = true;
          }
          continue;
        }

        const json = JSON.stringify(spec);
        serialised += 1;
        nextSources[id] = { spec, json, line: null };
        if (prior && prior.json === json) continue;
        changed[id] = spec;
        hasSourceChange = true;
      }

      for (const id of Object.keys(sentSources)) {
        if (id in specs.sources) continue;
        changed[id] = null;
        hasSourceChange = true;
      }
      sentSources = nextSources;

      const layers = diffSpec(sentLayers, specs.layers);
      sentLayers = layers.sent;

      const markers = diffSpec(sentMarkers, specs.markers ?? (EMPTY as MapMarkerSpec[]));
      sentMarkers = markers.sent;

      const images = diffSpec(sentImages, specs.images ?? (EMPTY as MapImageSpec[]));
      sentImages = images.sent;

      serialised += layers.serialised + markers.serialised + images.serialised;

      if (
        !hasSourceChange &&
        !hasAppend &&
        !layers.changed &&
        !markers.changed &&
        !images.changed
      ) {
        return { patch: null, serialised };
      }

      return {
        patch: {
          // The page needs its icons before any layer that names one, so the
          // images ride along whenever there is a patch at all.
          ...(images.changed || specs.images ? { images: specs.images ?? [] } : {}),
          ...(hasSourceChange ? { sources: changed } : {}),
          ...(hasAppend ? { appends } : {}),
          ...(layers.changed ? { layers: specs.layers } : {}),
          ...(markers.changed ? { markers: specs.markers ?? [] } : {}),
          ...(specs.interactiveLayers ? { interactiveLayers: specs.interactiveLayers } : {}),
        },
        serialised,
      };
    },
  };
}
