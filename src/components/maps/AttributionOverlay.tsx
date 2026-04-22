/**
 * AttributionOverlay - Map attribution text overlay
 *
 * Displays map source attribution (e.g. "© OpenStreetMap") at the bottom of a map.
 * Manages its own internal state so the parent can update attribution via a ref
 * without causing a re-render of the map container.
 *
 * Used by ActivityMapView; extracted for reuse and readability.
 */

import React, { memo, forwardRef, useImperativeHandle, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/theme';

export interface AttributionOverlayRef {
  setAttribution: (text: string) => void;
}

export interface AttributionOverlayProps {
  initialAttribution: string;
}

export const AttributionOverlay = memo(
  forwardRef<AttributionOverlayRef, AttributionOverlayProps>(({ initialAttribution }, ref) => {
    const [attribution, setAttribution] = useState(initialAttribution);

    useImperativeHandle(ref, () => ({
      setAttribution,
    }));

    return (
      <View style={attributionStyles.attribution}>
        <View style={attributionStyles.attributionPill}>
          <Text style={attributionStyles.attributionText}>{attribution}</Text>
        </View>
      </View>
    );
  })
);

AttributionOverlay.displayName = 'AttributionOverlay';

const attributionStyles = StyleSheet.create({
  attribution: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 4,
    zIndex: 5,
  },
  attributionPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: spacing.sm,
  },
  attributionText: {
    fontSize: 9,
    color: colors.textSecondary,
  },
});
