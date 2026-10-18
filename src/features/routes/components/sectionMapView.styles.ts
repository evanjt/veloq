import { StyleSheet } from 'react-native';

import { colorWithOpacity, darkColors, ink, layers, layout, opacity, spacing } from '@/theme';

export const styles = StyleSheet.create({
  outerContainer: {
    position: 'relative',
  },
  container: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: layout.borderRadius,
  },
  mapLayer: {
    ...StyleSheet.absoluteFill,
  },
  map3DLayer: {
    zIndex: layers.raised,
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadius,
  },
  expandOverlay: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: colorWithOpacity(ink.black, opacity.disabled),
    borderRadius: layout.borderRadiusSm,
    padding: spacing.xs,
  },
  controlsContainer: {
    // `top` comes from the caller, alongside the legend's: the map draws under
    // the status bar and a fixed guess at the inset clears it on some screens only. So does
    // `maxHeight`, which keeps the column inside the map and wraps the rest beside it.
    position: 'absolute',
    right: layout.cardMargin,
    gap: spacing.sm,
    // Further columns go to the left, so the first stays on the map's edge.
    flexWrap: 'wrap-reverse',
    justifyContent: 'flex-start',
    zIndex: layers.mapOverlay,
  },
  controlButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colorWithOpacity(ink.white, 0.95),
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonDark: {
    backgroundColor: darkColors.surfaceRaised,
  },
});
