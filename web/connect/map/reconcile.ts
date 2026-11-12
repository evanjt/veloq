// What a map pane does to the renderer when its spec changes: the difference
// between two specs as a list of steps, so the pane only applies them and a
// test reads them. A spec is the phone's `MapSurfaceSpec`: sources and layers
// by id, in drawing order.

import type {
  MapLayerSpec,
  MapSourceSpec,
  MapSurfaceSpec,
} from '@/features/maps/lib/htmlBuilders/mapSurface';

export type Step =
  | { do: 'removeLayer'; id: string }
  | { do: 'removeSource'; id: string }
  | { do: 'addSource'; id: string; spec: MapSourceSpec }
  | { do: 'setData'; id: string; data: unknown }
  | { do: 'setTiles'; id: string; tiles: string[] }
  | { do: 'addLayer'; spec: MapLayerSpec; before: string | undefined }
  | { do: 'updateLayer'; spec: MapLayerSpec; previous: MapLayerSpec };

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Options a source is built with and cannot change afterwards. A change to one
 * is a source taken down and put up again, with its layers.
 */
function signature(spec: MapSourceSpec): string {
  if (spec.kind === 'raster') {
    return JSON.stringify(['raster', spec.tileSize, spec.minzoom, spec.maxzoom]);
  }
  return JSON.stringify([
    'geojson',
    spec.cluster,
    spec.clusterRadius,
    spec.clusterMaxZoom,
    spec.clusterProperties,
    spec.lineMetrics,
    spec.tolerance,
  ]);
}

/** The layer a new one at `list[at]` goes under: its own `beforeId` when drawn, else the next one drawn. */
function before(list: MapLayerSpec[], at: number, drawn: ReadonlySet<string>): string | undefined {
  const spec = list[at];
  if (spec?.beforeId && drawn.has(spec.beforeId)) return spec.beforeId;
  for (let later = at + 1; later < list.length; later++) {
    const next = list[later];
    if (next && drawn.has(next.id)) return next.id;
  }
  return undefined;
}

/** The steps that take the renderer from `previous` to `next`; `previous` is null on the first. */
export function reconcile(previous: MapSurfaceSpec | null, next: MapSurfaceSpec): Step[] {
  const steps: Step[] = [];
  const oldSources = previous?.sources ?? {};
  const oldLayers = previous?.layers ?? [];
  const oldById = new Map(oldLayers.map((layer) => [layer.id, layer]));
  const wanted = new Set(next.layers.map((layer) => layer.id));

  const rebuilt = new Set<string>();
  for (const [id, spec] of Object.entries(oldSources)) {
    const now = next.sources[id];
    if (!now || signature(spec) !== signature(now)) rebuilt.add(id);
  }

  const drawn = new Set<string>();
  for (const layer of oldLayers) {
    if (wanted.has(layer.id) && !rebuilt.has(layer.source)) drawn.add(layer.id);
    else steps.push({ do: 'removeLayer', id: layer.id });
  }
  for (const id of rebuilt) steps.push({ do: 'removeSource', id });

  for (const [id, spec] of Object.entries(next.sources)) {
    const old = oldSources[id];
    if (!old || rebuilt.has(id)) {
      steps.push({ do: 'addSource', id, spec });
    } else if (spec.kind === 'geojson' && old.kind === 'geojson') {
      if (!same(old.data, spec.data)) steps.push({ do: 'setData', id, data: spec.data });
    } else if (spec.kind === 'raster' && old.kind === 'raster') {
      if (!same(old.tiles, spec.tiles)) steps.push({ do: 'setTiles', id, tiles: spec.tiles });
    }
  }

  // Backwards, so the layer a new one goes under is already drawn.
  const added: Step[] = [];
  for (let at = next.layers.length - 1; at >= 0; at--) {
    const layer = next.layers[at];
    if (!layer) continue;
    const old = drawn.has(layer.id) ? oldById.get(layer.id) : undefined;
    if (old) {
      if (!same(layer, old)) added.push({ do: 'updateLayer', spec: layer, previous: old });
    } else {
      added.push({ do: 'addLayer', spec: layer, before: before(next.layers, at, drawn) });
      drawn.add(layer.id);
    }
  }
  return [...steps, ...added];
}

/** What changes in the set of highlighted ids: the ids to light and the ids to put out. */
export function highlightChange(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>
): { light: string[]; out: string[] } {
  return {
    light: [...next].filter((id) => !previous.has(id)),
    out: [...previous].filter((id) => !next.has(id)),
  };
}
