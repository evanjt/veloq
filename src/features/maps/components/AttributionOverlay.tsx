/**
 * AttributionOverlay - Map attribution text overlay
 *
 * Displays map source attribution (e.g. "© OpenStreetMap") at the bottom of a map.
 * Manages its own internal state so the parent can update attribution via a ref
 * without causing a re-render of the map container.
 *
 * Used by ActivityMapView; extracted for reuse and readability.
 */

import React, { memo, forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { colors, spacing } from '@/theme';

const PILL_INSET = 4;
const PILL_PADDING_VERTICAL = 5;
const PILL_LINE_HEIGHT = 12;

/**
 * Vertical space a single-line pill claims above the map's bottom edge. Map
 * attribution is a licence condition, so anything drawn over the same corner
 * has to pad itself clear of this rather than cover it. It is only the value
 * to start from: the satellite credit runs to two rows at phone width, so a
 * caller that has to clear the pill takes the measured height from
 * `onClearanceChange` instead of assuming a line count.
 */
export const ATTRIBUTION_CLEARANCE = PILL_INSET + PILL_PADDING_VERTICAL * 2 + PILL_LINE_HEIGHT;

export interface AttributionOverlayRef {
  setAttribution: (text: string) => void;
}

export interface AttributionOverlayProps {
  initialAttribution: string;
  /** Measured pill height plus its inset, reported whenever the wrap changes. */
  onClearanceChange?: (clearance: number) => void;
}

export const AttributionOverlay = memo(
  forwardRef<AttributionOverlayRef, AttributionOverlayProps>(
    ({ initialAttribution, onClearanceChange }, ref) => {
      const [attribution, setAttribution] = useState(initialAttribution);
      const reportedRef = useRef<number | null>(null);

      useImperativeHandle(ref, () => ({
        setAttribution,
      }));

      const handleLayout = useCallback(
        (event: LayoutChangeEvent) => {
          const clearance = event.nativeEvent.layout.height + PILL_INSET;
          if (reportedRef.current === clearance) return;
          reportedRef.current = clearance;
          onClearanceChange?.(clearance);
        },
        [onClearanceChange]
      );

      return (
        <View testID="map-attribution" style={attributionStyles.attribution} pointerEvents="none">
          <View
            testID="map-attribution-pill"
            style={attributionStyles.attributionPill}
            onLayout={handleLayout}
          >
            <Text testID="map-attribution-text" style={attributionStyles.attributionText}>
              {attribution}
            </Text>
          </View>
        </View>
      );
    }
  )
);

AttributionOverlay.displayName = 'AttributionOverlay';

const attributionStyles = StyleSheet.create({
  attribution: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    alignItems: 'flex-end',
    paddingBottom: PILL_INSET,
    paddingRight: 6,
    zIndex: 5,
  },
  attributionPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: PILL_PADDING_VERTICAL,
    borderRadius: spacing.sm,
  },
  attributionText: {
    fontSize: 9,
    lineHeight: PILL_LINE_HEIGHT,
    color: colors.textSecondary,
  },
});
