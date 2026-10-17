import { StyleSheet } from 'react-native';

import {
  colorWithOpacity,
  darkColors,
  ink,
  layers,
  layout,
  opacity,
  shadows,
  spacing,
} from '@/theme';

// The loading veil covers the 3D map, which is raised over the 2D one. The
// layer scale has no rung between raised and sticky.
const ABOVE_3D_MAP = layers.raised + 1;

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
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: ABOVE_3D_MAP,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colorWithOpacity(ink.black, opacity.tint4),
    borderRadius: layout.borderRadius,
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
    borderRadius: layout.minTapTarget / 2,
    ...shadows.modal,
  },
  controlButtonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
});
