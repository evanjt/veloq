// One MapLibre map for the lifetime of the component. It is created once and
// never again on a prop change: a spec change is applied as the difference from
// the last one, a base change swaps the style and puts the spec back, and a
// camera change moves the camera.

import { useEffect, useRef } from 'react';

import type {
  MapLayerSpec,
  MapSourceSpec,
  MapSurfaceSpec,
} from '@/features/maps/lib/htmlBuilders/mapSurface';

import { hitBox, pickFeature, type PickedFeature } from './hit';
import { installProtocol, type Ask } from './protocol';
import { highlightChange, reconcile } from './reconcile';
import { pageAttribution, pageStyle, type PageBase } from './style';

export interface MapCamera {
  center?: maplibregl.LngLat;
  zoom?: number;
  /** Fit these bounds instead of centring. */
  bounds?: maplibregl.Bounds;
  padding?: number;
}

export interface MapPaneProps {
  base: PageBase;
  spec: MapSurfaceSpec;
  /** Controlled: a new camera moves the map, and the map's own movement does not report. */
  camera: MapCamera;
  /** Ids lit through feature state, as `highlighted`. */
  highlightedIds?: readonly string[];
  minZoom?: number;
  /** How the `veloq` sources reach the phone. */
  read: Ask;
  onHover?: (id: string | null) => void;
  onClick?: (feature: PickedFeature) => void;
}

const FIT_PADDING_PX = 48;

function sourceDefinition(spec: MapSourceSpec): object {
  if (spec.kind === 'raster') {
    const raster: Record<string, unknown> = {
      type: 'raster',
      tiles: spec.tiles,
      tileSize: spec.tileSize,
    };
    if (spec.minzoom !== undefined) raster.minzoom = spec.minzoom;
    if (spec.maxzoom !== undefined) raster.maxzoom = spec.maxzoom;
    return raster;
  }
  const geo: Record<string, unknown> = { type: 'geojson', data: spec.data, promoteId: 'id' };
  if (spec.cluster) {
    geo.cluster = true;
    if (spec.clusterRadius !== undefined) geo.clusterRadius = spec.clusterRadius;
    if (spec.clusterMaxZoom !== undefined) geo.clusterMaxZoom = spec.clusterMaxZoom;
    if (spec.clusterProperties) geo.clusterProperties = spec.clusterProperties;
  }
  if (spec.lineMetrics) geo.lineMetrics = true;
  if (spec.tolerance !== undefined) geo.tolerance = spec.tolerance;
  return geo;
}

function layerDefinition(spec: MapLayerSpec): maplibregl.LayerDefinition {
  const definition: maplibregl.LayerDefinition = {
    id: spec.id,
    type: spec.type,
    source: spec.source,
    paint: spec.paint ?? {},
    layout: { visibility: spec.visible === false ? 'none' : 'visible', ...spec.layout },
  };
  if (spec.filter) definition.filter = spec.filter;
  if (spec.minzoom !== undefined) definition.minzoom = spec.minzoom;
  return definition;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** A key the next spec drops reads as undefined and is cleared: paint with null, layout with undefined. */
function updateLayer(map: maplibregl.Map, spec: MapLayerSpec, previous: MapLayerSpec) {
  const paint = spec.paint ?? {};
  const oldPaint = previous.paint ?? {};
  for (const key of new Set([...Object.keys(paint), ...Object.keys(oldPaint)])) {
    if (!same(paint[key], oldPaint[key])) map.setPaintProperty(spec.id, key, paint[key] ?? null);
  }
  const layout = spec.layout ?? {};
  const oldLayout = previous.layout ?? {};
  for (const key of new Set([...Object.keys(layout), ...Object.keys(oldLayout)])) {
    if (!same(layout[key], oldLayout[key])) map.setLayoutProperty(spec.id, key, layout[key]);
  }
  if (spec.visible !== previous.visible) {
    map.setLayoutProperty(spec.id, 'visibility', spec.visible === false ? 'none' : 'visible');
  }
  if (!same(spec.filter, previous.filter)) map.setFilter(spec.id, spec.filter ?? null);
  if (spec.minzoom !== previous.minzoom) map.setLayerZoomRange(spec.id, spec.minzoom ?? 0, 24);
}

function apply(map: maplibregl.Map, previous: MapSurfaceSpec | null, next: MapSurfaceSpec) {
  for (const step of reconcile(previous, next)) {
    try {
      switch (step.do) {
        case 'removeLayer':
          if (map.getLayer(step.id)) map.removeLayer(step.id);
          break;
        case 'removeSource':
          if (map.getSource(step.id)) map.removeSource(step.id);
          break;
        case 'addSource':
          map.addSource(step.id, sourceDefinition(step.spec));
          break;
        case 'setData':
          map.getSource(step.id)?.setData(step.data);
          break;
        case 'setTiles':
          map.getSource(step.id)?.setTiles(step.tiles);
          break;
        case 'addLayer':
          map.addLayer(layerDefinition(step.spec), step.before);
          break;
        case 'updateLayer':
          updateLayer(map, step.spec, step.previous);
          break;
      }
    } catch (error) {
      console.warn(`map: ${step.do} ${'id' in step ? step.id : step.spec.id}: ${String(error)}`);
    }
  }
  for (const image of next.images ?? []) {
    if (map.hasImage(image.id)) continue;
    const picture = new Image();
    picture.onload = () => {
      if (!map.hasImage(image.id)) map.addImage(image.id, picture, { sdf: !!image.sdf });
    };
    picture.src = image.uri;
  }
}

const geojsonSources = (spec: MapSurfaceSpec) =>
  Object.entries(spec.sources)
    .filter(([, source]) => source.kind === 'geojson')
    .map(([id]) => id);

const toBounds = ([west, south, east, north]: maplibregl.Bounds): [
  [number, number],
  [number, number],
] => [
  [west, south],
  [east, north],
];

export function MapPane(props: MapPaneProps) {
  const container = useRef<HTMLDivElement>(null);
  const live = useRef<{
    map: maplibregl.Map;
    ready: boolean;
    applied: MapSurfaceSpec | null;
    lit: ReadonlySet<string>;
    base: PageBase;
  } | null>(null);
  // What the handlers below read, so the map is made once and they never go stale.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  function fit() {
    const { camera } = latest.current;
    const map = live.current?.map;
    if (!map || !camera.bounds) return;
    map.fitBounds(toBounds(camera.bounds), {
      padding: camera.padding ?? FIT_PADDING_PX,
      duration: 0,
    });
  }

  function light(spec: MapSurfaceSpec, ids: ReadonlySet<string>) {
    const state = live.current;
    if (!state?.ready) return;
    const { light: on, out } = highlightChange(state.lit, ids);
    for (const source of geojsonSources(spec)) {
      for (const id of out) state.map.removeFeatureState({ source, id }, 'highlighted');
      for (const id of on) state.map.setFeatureState({ source, id }, { highlighted: true });
    }
    state.lit = ids;
  }

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    const { camera, base, minZoom } = latest.current;
    const release = installProtocol(maplibregl, (method, params) =>
      latest.current.read(method, params)
    );
    const options: maplibregl.MapOptions = {
      container: element,
      style: pageStyle(base),
      center: camera.center ?? [0, 0],
      zoom: camera.zoom ?? 1,
      attributionControl: false,
      fadeDuration: 0,
    };
    if (minZoom !== undefined) options.minZoom = minZoom;
    const map = new maplibregl.Map(options);
    const state = {
      map,
      ready: false,
      applied: null as MapSurfaceSpec | null,
      lit: new Set<string>() as ReadonlySet<string>,
      base,
    };
    live.current = state;

    function interactive() {
      return latest.current.spec.interactiveLayers ?? [];
    }
    function pick(point: { x: number; y: number }): PickedFeature | null {
      const layers = interactive().filter((id) => map.getLayer(id));
      if (layers.length === 0) return null;
      try {
        return pickFeature(map.queryRenderedFeatures(hitBox(point.x, point.y), { layers }), layers);
      } catch {
        return null;
      }
    }

    function show() {
      state.ready = true;
      state.applied = null;
      apply(map, null, latest.current.spec);
      state.applied = latest.current.spec;
      light(latest.current.spec, new Set(latest.current.highlightedIds ?? []));
      if (latest.current.camera.bounds) fit();
    }
    map.once('load', show);

    let hovered: string | null = null;
    const move = (event: maplibregl.PointerEvent) => {
      const found = pick(event.point);
      map.getCanvas().style.cursor = found ? 'pointer' : '';
      const id = found?.id ?? null;
      if (id !== hovered) {
        hovered = id;
        latest.current.onHover?.(id);
      }
    };
    const click = (event: maplibregl.PointerEvent) => {
      const found = pick(event.point);
      if (found) latest.current.onClick?.(found);
    };
    const leave = () => {
      if (hovered !== null) {
        hovered = null;
        latest.current.onHover?.(null);
      }
    };
    map.on('mousemove', move);
    map.on('click', click);
    map.getCanvas().addEventListener('mouseleave', leave);
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(element);

    return () => {
      resize.disconnect();
      release();
      map.remove();
      live.current = null;
    };
  }, []);

  const { spec, base, camera, highlightedIds } = props;

  useEffect(() => {
    const state = live.current;
    if (!state?.ready) return;
    if (state.base !== base) {
      state.base = base;
      state.ready = false;
      state.map.once('style.load', () => {
        state.ready = true;
        state.lit = new Set();
        apply(state.map, null, latest.current.spec);
        state.applied = latest.current.spec;
        light(latest.current.spec, new Set(latest.current.highlightedIds ?? []));
      });
      state.map.setStyle(pageStyle(base));
      return;
    }
    apply(state.map, state.applied, spec);
    state.applied = spec;
  }, [spec, base]);

  const cameraKey = JSON.stringify(camera);
  const firstCamera = useRef(true);
  useEffect(() => {
    if (firstCamera.current) {
      firstCamera.current = false;
      return;
    }
    const map = live.current?.map;
    if (!map) return;
    const { bounds, center, zoom } = latest.current.camera;
    if (bounds) fit();
    else
      map.jumpTo({
        ...(center && { center }),
        ...(zoom !== undefined && { zoom }),
      });
  }, [cameraKey]);

  const lit = (highlightedIds ?? []).join('\n');
  useEffect(() => {
    light(latest.current.spec, new Set(latest.current.highlightedIds ?? []));
  }, [lit, spec]);

  return (
    <div
      className="map-pane"
      role="region"
      aria-label="Map"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          fit();
        }
      }}
    >
      <div ref={container} className="map-canvas" />
      <p className="map-attribution">{pageAttribution()}</p>
    </div>
  );
}
