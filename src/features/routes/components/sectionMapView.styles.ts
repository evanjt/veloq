import { StyleSheet } from 'react-native';

import { colors, darkColors, spacing, layout, shadows, colorWithOpacity, ink } from '@/theme';

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
    zIndex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colorWithOpacity(ink.black, 0.3),
    borderRadius: layout.borderRadius,
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
    backgroundColor: colorWithOpacity(ink.black, 0.5),
    borderRadius: layout.borderRadiusSm,
    padding: spacing.xs,
  },
  controlsContainer: {
    // `top` comes from the caller, alongside the legend's: the map draws under
    // the status bar and a fixed guess at the inset clears it on some screens only.
    position: 'absolute',
    right: layout.cardMargin,
    gap: spacing.sm,
    zIndex: 100,
    elevation: 100,
  },
  controlButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    backgroundColor: colorWithOpacity(ink.white, 0.95),
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.modal,
  },
  controlButtonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  controlButtonActive: {
    backgroundColor: colors.primary,
  },
});
