import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme';
import type { MapSurfaceRef } from '../MapSurface';
import { CLUSTER_CIRCLE_LAYER_ID } from './regionalMapLayerSpecs';

/**
 * Overlay of React Text nodes showing cluster counts on top of the regional map.
 *
 * The map draws the counts itself as symbol glyphs. Those live inside the
 * WebView canvas, so they are invisible to accessibility tools and to Maestro.
 * This component asks the page which clusters are currently drawn and where
 * they sit on screen, then places a matching node over each one. Each node
 * carries a testID so automated tests can assert on cluster visibility, and it
 * participates in the accessibility tree.
 *
 * The overlay is invisible by default - it does not duplicate the drawn glyphs.
 * Set `visible` to show it for debugging or design work.
 */

export interface ClusterCountOverlayRef {
  /** Re-query clusters; call once the map has settled. */
  refresh: () => void;
}

interface ClusterCountOverlayProps {
  surfaceRef: React.RefObject<MapSurfaceRef | null>;
  /** Show the overlay text visibly (for debug or as the primary label source). */
  visible?: boolean;
}

interface ClusterPoint {
  id: number;
  count: number;
  x: number;
  y: number;
}

/** Give the first paint time to settle before the first query. */
const INITIAL_QUERY_DELAY_MS = 250;

export const ClusterCountOverlay = React.forwardRef<
  ClusterCountOverlayRef,
  ClusterCountOverlayProps
>(function ClusterCountOverlay({ surfaceRef, visible = false }, ref) {
  const [clusters, setClusters] = useState<ClusterPoint[]>([]);
  const latestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const seq = ++latestSeq.current;
    try {
      const features = await surface.queryViewportFeatures([CLUSTER_CIRCLE_LAYER_ID]);
      if (seq !== latestSeq.current) return;
      setClusters(
        features
          .filter((feature) => feature.screen != null)
          .map((feature) => ({
            id: Number(feature.properties.cluster_id ?? 0),
            count: Number(feature.properties.point_count ?? 0),
            x: feature.screen!.x,
            y: feature.screen!.y,
          }))
      );
    } catch {
      // The page may not be ready yet. The next region change retries.
    }
  }, [surfaceRef]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  useEffect(() => {
    // One refresh on mount so testIDs exist before the first region change.
    const timer = setTimeout(refresh, INITIAL_QUERY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [refresh]);

  return (
    <View style={styles.container} pointerEvents="none">
      {clusters.map((cluster) => (
        <View
          key={`cluster-${cluster.id}`}
          testID={`map-cluster-count-${cluster.id}`}
          accessibilityLabel={`${cluster.count} activities`}
          style={[styles.countHitbox, { left: cluster.x - 16, top: cluster.y - 8 }]}
        >
          {visible && <Text style={styles.countLabelVisible}>{cluster.count}</Text>}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
  },
  countHitbox: {
    position: 'absolute',
    width: 32,
    height: 16,
  },
  countLabelVisible: {
    color: colors.textOnDark,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
