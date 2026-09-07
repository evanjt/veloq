import { StyleSheet } from 'react-native';

import { colors, darkColors, spacing, layout, shadows, typography } from '@/theme';

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
    backgroundColor: 'rgba(0,0,0,0.3)',
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
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 12,
    height: 12,
    borderRadius: layout.borderRadiusFull,
    borderWidth: 1.5,
    borderColor: colors.textOnDark,
  },
  startMarker: {
    backgroundColor: 'rgba(34,197,94,0.75)',
  },
  endMarker: {
    backgroundColor: 'rgba(239,68,68,0.75)',
  },
  nearbyMarker: {
    width: 10,
    height: 10,
    borderRadius: layout.borderRadiusFull,
    borderWidth: 1.5,
    borderColor: colors.textOnDark,
    opacity: 0.5,
  },
  nearbyStartMarker: {
    backgroundColor: 'rgba(34,197,94,0.6)',
  },
  nearbyEndMarker: {
    backgroundColor: 'rgba(239,68,68,0.6)',
  },
  nearbyPopup: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: spacing.sm,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadows.card,
  },
  nearbyPopupDark: {
    backgroundColor: darkColors.surface,
  },
  nearbyPopupContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nearbyPopupInfo: {
    flex: 1,
  },
  nearbyPopupName: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  nearbyPopupMeta: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  nearbyPopupViewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  nearbyPopupViewText: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.primary,
  },
  nearbyPopupClose: {
    padding: spacing.xs,
  },
  expandOverlay: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: spacing.xsPlus,
    padding: spacing.xs,
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
