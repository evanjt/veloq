import { StyleSheet } from 'react-native';
import { colors, darkColors, spacing, layout, typography } from '@/theme';

export const settingsStyles = StyleSheet.create({
  // Card container
  sectionCard: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: layout.borderRadius,
    overflow: 'hidden' as const,
  },
  sectionCardDark: {
    backgroundColor: darkColors.surfaceRaised,
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
    color: colors.textOnFill,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },

  // A granted permission, a result longer than a badge holds, so it is text.
  scopeText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
