/**
 * Renders map source and layer specs through the native MapLibre components.
 *
 * `BaseMapView` still takes overlay JSX as children while it is on the native
 * renderer, so this adapter lets a caller describe its overlays once, as specs,
 * and have both the WebView surface and the fullscreen shell draw them. It goes
 * away with the last native map.
 */
import React from 'react';
import { CircleLayer, LineLayer, ShapeSource } from '@maplibre/maplibre-react-native';

import type { MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';

interface NativeSpecLayersProps {
  sources: Record<string, MapSourceSpec>;
  layers: MapLayerSpec[];
  /** Prefixes every generated id so two overlay sets can coexist. */
  idPrefix: string;
}

// Native layer props are camelCased where the style spec is kebab-cased.
function toNativeStyle(spec: MapLayerSpec): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...spec.paint, ...spec.layout })) {
    if (key === 'visibility') continue;
    style[key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  if (spec.visible === false) {
    style.lineOpacity = 0;
    style.circleOpacity = 0;
  }
  return style;
}

export function NativeSpecLayers({ sources, layers, idPrefix }: NativeSpecLayersProps) {
  return (
    <>
      {Object.entries(sources).map(([sourceId, source]) => {
        if (source.kind !== 'geojson') return null;
        const sourceLayers = layers.filter((layer) => layer.source === sourceId);
        return (
          <ShapeSource key={sourceId} id={`${idPrefix}-${sourceId}`} shape={source.data}>
            {sourceLayers.map((layer) => {
              const id = `${idPrefix}-${layer.id}`;
              const style = toNativeStyle(layer);
              if (layer.type === 'circle') {
                return (
                  <CircleLayer
                    key={id}
                    id={id}
                    filter={layer.filter as never}
                    style={style as never}
                  />
                );
              }
              return (
                <LineLayer key={id} id={id} filter={layer.filter as never} style={style as never} />
              );
            })}
          </ShapeSource>
        );
      })}
    </>
  );
}
