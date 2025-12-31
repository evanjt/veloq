/**
 * Shared hook for chart gesture handling.
 *
 * Provides gesture-based selection for Victory Native charts with:
 * - UI thread gesture tracking (120Hz)
 * - Derived index calculation from touch position
 * - JS thread bridge for state updates
 * - Animated crosshair positioning
 */

import { useCallback, useRef, useState, useMemo } from 'react';
import { Platform } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  useSharedValue,
  useAnimatedReaction,
  useDerivedValue,
  useAnimatedStyle,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';

// Gesture configuration constants
const IOS_MIN_DISTANCE = 10;
const IOS_ACTIVE_OFFSET = 15;
const LONG_PRESS_DELAY_MS = 700;

interface ChartBounds {
  left: number;
  right: number;
}

interface UseChartGestureOptions<T> {
  /** Number of data points */
  dataLength: number;
  /** Callback when a point is selected */
  onPointSelect?: (index: number | null, data?: T) => void;
  /** Callback when interaction starts/ends */
  onInteractionChange?: (isInteracting: boolean) => void;
  /** Get data at index for callbacks */
  getDataAtIndex?: (index: number) => T | undefined;
  /** Optional shared value for syncing with other charts */
  sharedSelectedIdx?: SharedValue<number>;
  /** Optional external selection (from parent) */
  externalSelectedIdx?: SharedValue<number>;
}

interface UseChartGestureResult {
  /** Whether user is actively interacting */
  isActive: boolean;
  /** Currently selected index (-1 if none) */
  selectedIndex: number | null;
  /** Shared value for chart bounds - update this from Victory render callback */
  chartBoundsShared: SharedValue<ChartBounds>;
  /** Shared value for point x-coordinates - update this from Victory render callback */
  pointXCoordsShared: SharedValue<number[]>;
  /** Pan gesture to attach to GestureDetector */
  gesture: ReturnType<typeof Gesture.Pan>;
  /** Animated style for crosshair positioning */
  crosshairStyle: ReturnType<typeof useAnimatedStyle>;
  /** Reset the gesture state */
  reset: () => void;
}

/**
 * Hook for chart gesture handling with Victory Native + Reanimated.
 *
 * @example
 * ```tsx
 * const { isActive, gesture, crosshairStyle, chartBoundsShared, pointXCoordsShared } = useChartGesture({
 *   dataLength: data.length,
 *   onPointSelect: (idx) => setSelectedPoint(data[idx]),
 *   onInteractionChange: (active) => setScrollEnabled(!active),
 * });
 *
 * return (
 *   <GestureDetector gesture={gesture}>
 *     <View>
 *       <CartesianChart ...>
 *         {({ chartBounds, points }) => {
 *           // Sync bounds for gesture calculation
 *           chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
 *           pointXCoordsShared.value = points.y.map(p => p.x);
 *           return <Line points={points.y} />;
 *         }}
 *       </CartesianChart>
 *       <Animated.View style={[styles.crosshair, crosshairStyle]} />
 *     </View>
 *   </GestureDetector>
 * );
 * ```
 */
export function useChartGesture<T = unknown>(
  options: UseChartGestureOptions<T>
): UseChartGestureResult {
  const {
    dataLength,
    onPointSelect,
    onInteractionChange,
    getDataAtIndex,
    sharedSelectedIdx,
    externalSelectedIdx,
  } = options;

  // React state
  const [isActive, setIsActive] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Refs for callbacks (avoid stale closures)
  const onPointSelectRef = useRef(onPointSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  const getDataAtIndexRef = useRef(getDataAtIndex);
  const lastNotifiedIdx = useRef<number | null>(null);
  const isActiveRef = useRef(false);

  // Keep refs updated
  onPointSelectRef.current = onPointSelect;
  onInteractionChangeRef.current = onInteractionChange;
  getDataAtIndexRef.current = getDataAtIndex;

  // Shared values for UI thread
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue<ChartBounds>({ left: 0, right: 1 });
  const pointXCoordsShared = useSharedValue<number[]>([]);

  // Derive selected index on UI thread
  const selectedIdx = useDerivedValue(() => {
    'worklet';
    const bounds = chartBoundsShared.value;
    const chartWidth = bounds.right - bounds.left;

    if (touchX.value < 0 || chartWidth <= 0 || dataLength === 0) return -1;

    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidth));
    const idx = Math.round(ratio * (dataLength - 1));

    return Math.min(Math.max(0, idx), dataLength - 1);
  }, [dataLength]);

  // Bridge to JS thread for state updates
  const updateOnJS = useCallback((idx: number) => {
    if (idx < 0) {
      if (lastNotifiedIdx.current !== null) {
        setSelectedIndex(null);
        setIsActive(false);
        isActiveRef.current = false;
        lastNotifiedIdx.current = null;
        onPointSelectRef.current?.(null);
        onInteractionChangeRef.current?.(false);
      }
      return;
    }

    if (idx === lastNotifiedIdx.current) return;
    lastNotifiedIdx.current = idx;

    if (!isActiveRef.current) {
      setIsActive(true);
      isActiveRef.current = true;
      onInteractionChangeRef.current?.(true);
    }

    setSelectedIndex(idx);
    const data = getDataAtIndexRef.current?.(idx);
    onPointSelectRef.current?.(idx, data);
  }, []);

  // React to index changes
  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      runOnJS(updateOnJS)(idx);
    },
    [updateOnJS]
  );

  // Sync with shared selection from other charts
  useAnimatedReaction(
    () => sharedSelectedIdx?.value ?? -1,
    (idx) => {
      if (idx >= 0 && touchX.value < 0) {
        // External selection, update our state
        runOnJS(updateOnJS)(idx);
      }
    },
    [updateOnJS]
  );

  // Update shared index when local selection changes
  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      if (sharedSelectedIdx && idx >= 0) {
        sharedSelectedIdx.value = idx;
      }
    },
    []
  );

  // Pan gesture
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onUpdate((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onEnd(() => {
          'worklet';
          touchX.value = -1;
        })
        .minDistance(Platform.OS === 'ios' ? IOS_MIN_DISTANCE : 0)
        .activeOffsetX(Platform.OS === 'ios' ? [-IOS_ACTIVE_OFFSET, IOS_ACTIVE_OFFSET] : 0)
        .activateAfterLongPress(LONG_PRESS_DELAY_MS),
    [touchX]
  );

  // Animated crosshair style - uses point coordinates for accuracy
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const coords = pointXCoordsShared.value;

    // Priority: local touch > shared value > external selection
    let idx = selectedIdx.value;
    if (idx < 0 && sharedSelectedIdx) {
      idx = sharedSelectedIdx.value;
    }
    if (idx < 0 && externalSelectedIdx) {
      idx = externalSelectedIdx.value;
    }

    if (idx < 0 || coords.length === 0 || idx >= coords.length) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    return {
      opacity: 1,
      transform: [{ translateX: coords[idx] }],
    };
  }, [sharedSelectedIdx, externalSelectedIdx]);

  // Reset function
  const reset = useCallback(() => {
    touchX.value = -1;
    setIsActive(false);
    setSelectedIndex(null);
    isActiveRef.current = false;
    lastNotifiedIdx.current = null;
  }, [touchX]);

  return {
    isActive,
    selectedIndex,
    chartBoundsShared,
    pointXCoordsShared,
    gesture,
    crosshairStyle,
    reset,
  };
}

export default useChartGesture;
