/**
 * Unified chart gesture hook for all chart components.
 *
 * This hook consolidates the duplicated gesture handling code from:
 * - PowerCurveChart
 * - PaceCurveChart
 * - SwimPaceCurveChart
 * - ActivityDataChart
 * - FitnessChart
 * - ActivityHeatmap
 * - ZoneDistributionChart
 * - WellnessTrendsChart
 * - FitnessFormChart
 *
 * The simplified API reduces 10+ shared values to 4 clean outputs.
 */

import { useCallback, useRef, useState } from 'react';
import { Gesture, GestureType } from 'react-native-gesture-handler';
import { CHART_CONFIG } from '@/constants';
import {
  useSharedValue,
  useAnimatedReaction,
  useDerivedValue,
  useAnimatedStyle,
  runOnJS,
  SharedValue,
  AnimatedStyle,
} from 'react-native-reanimated';
import { ViewStyle } from 'react-native';

// ============================================================================
// Types
// ============================================================================

export interface ChartPoint {
  x: number;
  y: number;
  [key: string]: unknown;
}

export interface ChartBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChartGestureOptions<T extends ChartPoint = ChartPoint> {
  /** Chart data points */
  data: T[];

  /** Called when a point is selected */
  onSelect?: (point: T, index: number) => void;

  /** Called when interaction starts/ends */
  onInteractionChange?: (isActive: boolean) => void;

  /** Enable/disable gesture handling */
  enabled?: boolean;

  /** Activation delay in ms (default: 700ms for long press) */
  activationDelay?: number;

  /** Optional external shared value for cross-chart sync */
  sharedSelectedIdx?: SharedValue<number>;

  /** X domain for log-scale charts [min, max] */
  xDomain?: [number, number];
}

export interface ChartGestureResult<T extends ChartPoint = ChartPoint> {
  /** The pan gesture to attach to GestureDetector */
  gesture: GestureType;

  /** Currently selected index (-1 if none) */
  selectedIndex: SharedValue<number>;

  /** X position of touch/crosshair */
  crosshairX: SharedValue<number>;

  /** Whether user is actively interacting */
  isActive: boolean;

  /** Selected data point (null if none) */
  selectedPoint: T | null;

  /** Animated style for crosshair positioning */
  crosshairStyle: AnimatedStyle<ViewStyle>;

  /** Call this from CartesianChart render to sync bounds */
  syncBounds: (bounds: ChartBounds) => void;

  /** Call this to sync x-coordinates of data points (for snapping) */
  syncXCoords: (coords: number[]) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useChartGestures<T extends ChartPoint = ChartPoint>(
  options: ChartGestureOptions<T>
): ChartGestureResult<T> {
  const {
    data,
    onSelect,
    onInteractionChange,
    enabled = true,
    activationDelay = CHART_CONFIG.LONG_PRESS_DURATION,
    sharedSelectedIdx,
    xDomain,
  } = options;

  // Internal state
  const [isActive, setIsActive] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<T | null>(null);
  const lastNotifiedIdx = useRef<number | null>(null);

  // Shared values for worklet-JS bridge
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue<ChartBounds>({
    left: 0,
    right: 1,
    top: 0,
    bottom: 1,
  });
  const xCoordsShared = useSharedValue<number[]>([]);
  const xDomainShared = useSharedValue<[number, number]>(xDomain || [0, 1]);

  // Use external shared index if provided, otherwise create internal one
  const internalSelectedIdx = useSharedValue(-1);
  const selectedIndex = sharedSelectedIdx || internalSelectedIdx;

  // Update xDomain when it changes
  if (xDomain) {
    xDomainShared.value = xDomain;
  }

  // Derive selected index from touch position
  const derivedSelectedIdx = useDerivedValue(() => {
    'worklet';
    const len = data.length;
    const bounds = chartBoundsShared.value;
    const chartWidth = bounds.right - bounds.left;

    if (touchX.value < 0 || chartWidth <= 0 || len === 0) return -1;

    const xCoords = xCoordsShared.value;
    const [xMin, xMax] = xDomainShared.value;

    // If we have x coordinates, snap to nearest point
    if (xCoords.length === len) {
      const chartX = touchX.value - bounds.left;
      const ratio = Math.max(0, Math.min(1, chartX / chartWidth));
      const targetX = xMin + ratio * (xMax - xMin);

      // Find closest point
      let closestIdx = 0;
      let closestDiff = Math.abs(xCoords[0] - targetX);
      for (let i = 1; i < len; i++) {
        const diff = Math.abs(xCoords[i] - targetX);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = i;
        }
      }
      return closestIdx;
    }

    // Fallback: linear interpolation
    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidth));
    return Math.round(ratio * (len - 1));
  }, [data.length]);

  // Sync derived index to output shared value
  useAnimatedReaction(
    () => derivedSelectedIdx.value,
    (idx) => {
      selectedIndex.value = idx;
    },
    [derivedSelectedIdx]
  );

  // Update JS state when selection changes
  const handleSelectionChange = useCallback(
    (idx: number) => {
      if (idx < 0 || data.length === 0) {
        if (lastNotifiedIdx.current !== null) {
          setSelectedPoint(null);
          setIsActive(false);
          onInteractionChange?.(false);
          lastNotifiedIdx.current = null;
        }
        return;
      }

      if (idx === lastNotifiedIdx.current) return;
      lastNotifiedIdx.current = idx;

      if (!isActive) {
        setIsActive(true);
        onInteractionChange?.(true);
      }

      const point = data[idx];
      if (point) {
        setSelectedPoint(point);
        onSelect?.(point, idx);
      }
    },
    [data, isActive, onSelect, onInteractionChange]
  );

  // Bridge worklet to JS
  useAnimatedReaction(
    () => selectedIndex.value,
    (idx) => {
      runOnJS(handleSelectionChange)(idx);
    },
    [handleSelectionChange]
  );

  // Create pan gesture
  const gesture = Gesture.Pan()
    .onStart((e) => {
      'worklet';
      if (enabled) {
        touchX.value = e.x;
      }
    })
    .onUpdate((e) => {
      'worklet';
      if (enabled) {
        touchX.value = e.x;
      }
    })
    .onEnd(() => {
      'worklet';
      touchX.value = -1;
    })
    .minDistance(0)
    .activateAfterLongPress(activationDelay)
    .enabled(enabled);

  // Animated crosshair style
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    if (touchX.value < 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    // Clamp to chart bounds
    const bounds = chartBoundsShared.value;
    const xPos = Math.max(bounds.left, Math.min(bounds.right, touchX.value));

    return { opacity: 1, transform: [{ translateX: xPos }] };
  }, []);

  // Sync functions for CartesianChart render callback
  const syncBounds = useCallback(
    (bounds: ChartBounds) => {
      const current = chartBoundsShared.value;
      if (
        bounds.left !== current.left ||
        bounds.right !== current.right ||
        bounds.top !== current.top ||
        bounds.bottom !== current.bottom
      ) {
        chartBoundsShared.value = bounds;
      }
    },
    [chartBoundsShared]
  );

  const syncXCoords = useCallback(
    (coords: number[]) => {
      if (coords.length !== xCoordsShared.value.length) {
        xCoordsShared.value = coords;
      }
    },
    [xCoordsShared]
  );

  return {
    gesture,
    selectedIndex,
    crosshairX: touchX,
    isActive,
    selectedPoint,
    crosshairStyle,
    syncBounds,
    syncXCoords,
  };
}

export default useChartGestures;
