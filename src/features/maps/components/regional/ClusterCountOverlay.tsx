import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/theme';
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

/**
 * Whether the nodes are worth the round trip into the page.
 *
 * Nothing reads them otherwise. The counts the athlete sees are symbol glyphs
 * the map draws inside the canvas, and these nodes exist for the two readers
 * that cannot see into it: an assistive technology, and Maestro. With neither
 * present and the overlay invisible, every pan settle was paying an
 * `injectJavaScript`, a `queryRenderedFeatures` with a projection per cluster,
 * a `postMessage` back and a React commit of one absolute `View` per cluster,
 * for nodes nobody would read.
 */
export function clusterOverlayNeeded(options: {
  visible: boolean;
  screenReaderOn: boolean;
  underTest: boolean;
}): boolean {
  return options.visible || options.screenReaderOn || options.underTest;
}

/**
 * A debug build is what Maestro drives, so the nodes it asserts on are there
 * for it. A release build is where the per-pan cost is the athlete's.
 */
const UNDER_TEST = __DEV__;

export const ClusterCountOverlay = React.forwardRef<
  ClusterCountOverlayRef,
  ClusterCountOverlayProps
>(function ClusterCountOverlay({ surfaceRef, visible = false }, ref) {
  const [clusters, setClusters] = useState<ClusterPoint[]>([]);
  const [screenReaderOn, setScreenReaderOn] = useState(false);
  const latestSeq = useRef(0);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (live) setScreenReaderOn(on);
      })
      .catch(() => {
        // A platform that cannot answer is not a reason to keep the round trip.
      });
    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setScreenReaderOn
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  const needed = clusterOverlayNeeded({ visible, screenReaderOn, underTest: UNDER_TEST });

  const refresh = useCallback(async () => {
    if (!needed) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const seq = ++latestSeq.current;
    try {
      const features = await surface.queryViewportFeatures([CLUSTER_CIRCLE_LAYER_ID]);
      if (seq !== latestSeq.current) return;
      setClusters(
        features.flatMap((feature) =>
          feature.screen
            ? [
                {
                  id: Number(feature.properties.cluster_id ?? 0),
                  count: Number(feature.properties.point_count ?? 0),
                  x: feature.screen.x,
                  y: feature.screen.y,
                },
              ]
            : []
        )
      );
    } catch {
      // The page may not be ready yet. The next region change retries.
    }
  }, [surfaceRef, needed]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  useEffect(() => {
    // Nodes from when it was needed would sit at the screen positions of a pan
    // ago, which is worse than none: a screen reader turned off mid-session
    // would keep reading stale counts at stale places.
    if (!needed) {
      setClusters([]);
      return undefined;
    }
    // One refresh on mount so testIDs exist before the first region change.
    const timer = setTimeout(refresh, INITIAL_QUERY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [refresh, needed]);

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
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    textAlign: 'center',
  },
});
