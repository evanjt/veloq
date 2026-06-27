import { StyleSheet } from 'react-native';

import { colors, darkColors, spacing, layout, shadows } from '@/theme';

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
    zIndex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: layout.borderRadius,
  },
  hiddenLayer: {
    opacity: 0,
    pointerEvents: 'none',
  },
  map: {
    flex: 1,
  },
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadius,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textOnDark,
  },
  sectionNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...shadows.pill,
  },
  prTrophyMarker: {
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -30 }],
  },
  prTrophyBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#D4AF37',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...shadows.pill,
  },
  sectionNumberBadgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },
  startMarker: {
    backgroundColor: 'rgba(34,197,94,0.75)',
  },
  endMarker: {
    backgroundColor: 'rgba(239,68,68,0.75)',
  },
  sectionCreationMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textOnDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionStartMarker: {
    backgroundColor: 'rgba(34,197,94,0.9)',
  },
  sectionEndMarker: {
    backgroundColor: 'rgba(239,68,68,0.9)',
  },
  highlightMarker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.textOnDark,
  },
  controlsContainer: {
    position: 'absolute',
    top: 48,
    right: layout.cardMargin,
    gap: spacing.sm,
    zIndex: 100,
    elevation: 100,
  },
  controlButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
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
