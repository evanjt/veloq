// `#/map`: the map pane under the rail, with the base toggle in a floating bar.
// It draws what the phone lists methods for: the heatmap tiles, and the route
// lines. The filters, layer toggles and the list of what is in view belong to
// the screens that build on this pane.

import { useMemo, useState } from 'react';

import type { MapSurfaceSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';

import { MapPane } from './MapPane';
import type { Ask } from './protocol';
import { baseForScheme, otherBase, pagePalette, type PageBase } from './style';

const WORLD_ZOOM = 2;
/** The heatmap is drawn from zoom 1; the map does not go out past it. */
const MIN_ZOOM = 1;
const HEATMAP_TILE_PX = 512;
const HEATMAP_MAX_ZOOM = 17;

const prefersDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** The spec for a base and the methods the phone lists. */
export function mapSpec(base: PageBase, methods: readonly string[]): MapSurfaceSpec {
  const palette = pagePalette(base);
  const sources: MapSurfaceSpec['sources'] = {};
  const layers: MapSurfaceSpec['layers'] = [];
  if (methods.includes('heatmap.tile')) {
    sources.heatmap = {
      kind: 'raster',
      tiles: [`veloq://heatmap-${base}/{z}/{x}/{y}`],
      tileSize: HEATMAP_TILE_PX,
      minzoom: MIN_ZOOM,
      maxzoom: HEATMAP_MAX_ZOOM,
    };
    layers.push({ id: 'heatmap', type: 'raster', source: 'heatmap' });
  }
  const interactiveLayers: string[] = [];
  if (methods.includes('geo.routeLines')) {
    sources.routes = { kind: 'geojson', data: 'veloq://geo/route-lines/all?v=0' };
    layers.push({
      id: 'routes',
      type: 'line',
      source: 'routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': palette.route,
        'line-width': ['case', ['boolean', ['feature-state', 'highlighted'], false], 5, 3],
      },
    });
    interactiveLayers.push('routes');
  }
  return { sources, layers, interactiveLayers };
}

export function MapScreen({ read, methods }: { read: Ask; methods: readonly string[] }) {
  const [base, setBase] = useState<PageBase>(() => baseForScheme(prefersDark()));
  const [hovered, setHovered] = useState<string | null>(null);
  const spec = useMemo(() => mapSpec(base, methods), [base, methods]);
  const camera = useMemo(() => ({ center: [0, 0] as maplibregl.LngLat, zoom: WORLD_ZOOM }), []);
  const highlighted = useMemo(() => (hovered === null ? [] : [hovered]), [hovered]);

  return (
    <section id="map-screen">
      <div id="map-bar">
        <button id="map-base" type="button" onClick={() => setBase(otherBase(base))}>
          {base === 'dark' ? 'Light map' : 'Dark map'}
        </button>
        <output id="map-hover" aria-live="polite">
          {hovered ?? ''}
        </output>
      </div>
      <MapPane
        base={base}
        spec={spec}
        camera={camera}
        minZoom={MIN_ZOOM}
        highlightedIds={highlighted}
        read={read}
        onHover={setHovered}
      />
    </section>
  );
}
