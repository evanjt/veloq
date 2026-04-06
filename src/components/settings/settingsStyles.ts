import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle, TextStyle } from 'react-native';
import { Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';

// Divider inset: paddingLeft (md=16) + icon width (22) + gap (sm=8) = 46
export const DIVIDER_INSET = spacing.md + 22 + spacing.sm;

export const settingsStyles = StyleSheet.create({
  // Section label (uppercase group header above cards)
  sectionLabel: {
    ...typography.statsLabel,
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
  },

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

  // Tappable row with icon + text + optional right element
  actionRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    minHeight: layout.minTapTarget,
  },

  // Text inside action row
  actionRowText: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
  },

  // Indented divider (inset past icon)
  rowDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: DIVIDER_INSET,
  },
  rowDividerDark: {
    backgroundColor: darkColors.border,
  },

  // Full-width divider within a card
  fullDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  fullDividerDark: {
    backgroundColor: darkColors.border,
  },

  // Hint/caption text below controls
  hintText: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },

  // Row with label + description + switch
  toggleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  toggleLabel: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
  },
  toggleDescription: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Standard dark mode text overrides
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },

  // Scope/permission badge
  scopeBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    backgroundColor: opacity.overlay.medium,
    paddingHorizontal: 6,
    paddingVertical: 2,
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
