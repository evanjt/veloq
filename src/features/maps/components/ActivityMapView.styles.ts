import { StyleSheet } from 'react-native';

import { darkColors, layers, layout, shadows, spacing } from '@/theme';

export const styles = StyleSheet.create({
  outerContainer: {
    position: 'relative',
  },
  container: {
    flex: 1,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
  },
  mapLayer: {
    ...StyleSheet.absoluteFill,
  },
  map3DLayer: {
    zIndex: layers.raised,
  },
  map: {
    flex: 1,
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadius,
  },
  controlsContainer: {
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
    ...shadows.modal,
  },
  controlButtonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
});
