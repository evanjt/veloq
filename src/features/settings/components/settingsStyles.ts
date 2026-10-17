import { StyleSheet } from 'react-native';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';

export const settingsStyles = StyleSheet.create({
  // Card container
  sectionCard: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: layout.borderRadius,
    overflow: 'hidden' as const,
  },
  sectionCardDark: {
    backgroundColor: darkColors.surfaceCard,
  },

  // Text inside action row
  actionRowText: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
  },

  // Hint/caption text below controls
  hintText: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },

  // Standard dark mode text overrides
  textLight: {
    color: colors.textOnDark,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },

  // Scope/permission badge
  scopeBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
    backgroundColor: opacity.overlay.medium,
    paddingHorizontal: spacing.xsPlus,
    paddingVertical: spacing.xxs,
    borderRadius: layout.borderRadiusXs,
  },
  scopeBadgeDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  scopeBadgeText: {
    ...typography.badge,
    color: colors.textSecondary,
  },
});
