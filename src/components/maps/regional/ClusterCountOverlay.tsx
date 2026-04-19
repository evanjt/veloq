import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type MapView from '@maplibre/maplibre-react-native';
import { colors } from '@/theme';

/**
 * Overlay of React Text nodes showing cluster counts on top of the regional map.
 *
 * The map's native SymbolLayer renders the same counts in bitmap form — nicely
 * themed, but invisible to accessibility tools (e.g. Maestro, TalkBack). This
 * component queries the map's rendered features and positions React Text elements
 * at the same screen coordinates. Each text node carries a testID so automated
 * tests can assert on cluster visibility, and the node participates in the
 * accessibility tree.
 *
 * The overlay is visually transparent (opacity: 0) — it does not duplicate the
 * native glyphs. Set `visible` to `true` to show it on top of or instead of the
 * native SymbolLayer for debugging / design exploration.
 */

export interface ClusterCountOverlayRef {
  /** Re-query clusters; call from map's onRegionDidChange / onMapIdle handlers. */
  refresh: () => void;
}

interface ClusterCountOverlayProps {
  mapRef: React.RefObject<React.ElementRef<typeof MapView.MapView> | null>;
  /** Show the overlay text visibly (for debug or as the primary label source). */
  visible?: boolean;
  /** Screen bounds to query in. Defaults to a generous rect; provide for tighter culling. */
  queryRect?: [number, number, number, number];
}

interface ClusterPoint {
  id: number;
  count: number;
  x: number;
  y: number;
}

export const ClusterCountOverlay = React.forwardRef<
  ClusterCountOverlayRef,
  ClusterCountOverlayProps
>(function ClusterCountOverlay({ mapRef, visible = false, queryRect }, ref) {
  const [clusters, setClusters] = useState<ClusterPoint[]>([]);
  const latestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const seq = ++latestSeq.current;
    try {
      // A generous rect covers a typical phone viewport when not provided.
      const rect = queryRect ?? [0, 0, 2000, 3000];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyMap = map as any;
      const resp = await anyMap.queryRenderedFeaturesInRect(
        rect,
        ['has', 'point_count'],
        ['cluster-circles']
      );
      const features: {
        geometry: { coordinates: [number, number] };
        properties: Record<string, unknown>;
      }[] = resp?.features ?? [];
      const points = await Promise.all(
        features.map(async (f) => {
          const [lng, lat] = f.geometry.coordinates;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p: [number, number] | undefined = await (map as any).getPointInView?.([lng, lat]);
          const id = Number(f.properties.cluster_id ?? 0);
          const count = Number(f.properties.point_count ?? 0);
          if (!p) return null;
          return { id, count, x: p[0], y: p[1] } satisfies ClusterPoint;
        })
      );
      if (seq !== latestSeq.current) return;
      setClusters(points.filter((p): p is ClusterPoint => p != null));
    } catch {
      // Swallow: the map may not be ready, queryRenderedFeaturesInRect may be
      // unimplemented on some MapLibre versions, etc.
    }
  }, [mapRef, queryRect]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  useEffect(() => {
    // One refresh on mount so testIDs exist before the first region change.
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  return (
    <View style={styles.container} pointerEvents="none">
      {clusters.map((c) => (
        <Text
          key={`cluster-${c.id}`}
          testID={`map-cluster-count-${c.id}`}
          accessibilityLabel={`${c.count} activities`}
          style={[
            styles.countLabel,
            visible && styles.countLabelVisible,
            { left: c.x - 16, top: c.y - 8 },
          ]}
        >
          {c.count}
        </Text>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  countLabel: {
    position: 'absolute',
    width: 32,
    textAlign: 'center',
    color: 'transparent',
    fontSize: 12,
    fontWeight: '600',
  },
  countLabelVisible: {
    color: colors.textOnDark,
  },
});
