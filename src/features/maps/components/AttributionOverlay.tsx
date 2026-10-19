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
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '@/shared/app';
import {
  colors,
  colorWithOpacity,
  darkColors,
  layers,
  opacity,
  spacing,
  typography,
} from '@/theme';
import { DenseText } from '@/shared/ui/DenseText';

const BAR_PADDING_VERTICAL = spacing.xxs;
const BAR_LINE_HEIGHT = typography.micro.lineHeight;

/**
 * Vertical space a one-line bar claims above the map's bottom edge. Map
 * attribution is a licence condition, so anything drawn over the same edge
 * has to pad itself clear of this rather than cover it. It is only the value
 * to start from: at a large font scale the credit grows a line, so a caller
 * that has to clear the bar takes the measured height from
 * `onClearanceChange` instead of assuming a line count.
 */
export const ATTRIBUTION_CLEARANCE = BAR_PADDING_VERTICAL * 2 + BAR_LINE_HEIGHT;

export interface AttributionOverlayRef {
  setAttribution: (text: string) => void;
}

export interface AttributionOverlayProps {
  initialAttribution: string;
  /** Measured bar height, reported whenever the wrap changes. */
  onClearanceChange?: ((clearance: number) => void) | undefined;
  /** Height over the map's foot that something else covers, which the bar sits on. */
  bottomInset?: number | undefined;
}

export const AttributionOverlay = memo(
  forwardRef<AttributionOverlayRef, AttributionOverlayProps>(
    ({ initialAttribution, onClearanceChange, bottomInset = 0 }, ref) => {
      // The bar is chrome, so it follows the app theme rather than the base drawn under it.
      const { isDark } = useTheme();
      const [attribution, setAttribution] = useState(initialAttribution);
      const reportedRef = useRef<number | null>(null);

      useImperativeHandle(ref, () => ({
        setAttribution,
      }));

      const handleLayout = useCallback(
        (event: LayoutChangeEvent) => {
          const clearance = event.nativeEvent.layout.height;
          if (reportedRef.current === clearance) return;
          reportedRef.current = clearance;
          onClearanceChange?.(clearance);
        },
        [onClearanceChange]
      );

      // A caller that waits on the map for its credit draws no blank bar meanwhile.
      if (!attribution) return null;

      return (
        <View
          testID="map-attribution"
          style={[attributionStyles.attribution, bottomInset > 0 && { bottom: bottomInset }]}
          pointerEvents="none"
        >
          <View
            testID="map-attribution-bar"
            style={[
              attributionStyles.attributionBar,
              {
                backgroundColor: colorWithOpacity(
                  (isDark ? darkColors : colors).surfaceRaised,
                  opacity.pressed
                ),
              },
            ]}
            onLayout={handleLayout}
          >
            <DenseText
              testID="map-attribution-text"
              style={[
                attributionStyles.attributionText,
                isDark && attributionStyles.attributionTextDark,
              ]}
            >
              {attribution}
            </DenseText>
          </View>
        </View>
      );
    }
  )
);

AttributionOverlay.displayName = 'AttributionOverlay';

const attributionStyles = StyleSheet.create({
  attribution: {
    // Spanning the map gives the credit the whole width, so the long satellite
    // credit fits one line at phone width rather than wrapping in a corner. It
    // is a licence condition, so past one line it wraps, never truncates.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: layers.mapOverlay,
  },
  attributionBar: {
    paddingHorizontal: spacing.sm,
    paddingVertical: BAR_PADDING_VERTICAL,
  },
  attributionText: {
    ...typography.micro,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  attributionTextDark: {
    color: darkColors.textSecondary,
  },
});
