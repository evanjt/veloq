/**
 * Shared styles used across multiple screens and components.
 * Import these instead of duplicating style definitions.
 *
 * Usage:
 * ```typescript
 * import { createSharedStyles } from '@/styles';
 *
 * const { isDark } = useTheme();
 * const shared = createSharedStyles(isDark);
 *
 * <View style={shared.container}>
 *   <View style={shared.header}>
 *     <Text style={shared.headerTitle}>Title</Text>
 *   </View>
 * </View>
 * ```
 */
import { StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { colors, darkColors, spacing, layout, typography } from '@/theme';

/**
 * Creates theme-aware shared styles.
 * Call this with isDark from useTheme() to get the correct styles for the current theme.
 */
export const createSharedStyles = (isDark: boolean) => {
  const c = isDark ? darkColors : colors;

  return StyleSheet.create({
    // =========================================================================
    // LAYOUT CONTAINERS
    // =========================================================================

    /** Full-screen container with theme background */
    container: {
      flex: 1,
      backgroundColor: isDark ? darkColors.background : colors.background,
    },

    /** ScrollView wrapper - use with contentContainerStyle={shared.scrollContent} */
    scrollView: {
      flex: 1,
    },

    /** ScrollView content container with standard padding */
    scrollContent: {
      paddingHorizontal: layout.screenPadding,
      paddingBottom: spacing.xl,
    },

    /** Centered content container (for loading states, empty states) */
    centeredContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },

    /** Loading container with centered spinner */
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDark ? darkColors.background : colors.background,
    },

    /** Empty state container */
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.xl,
    },

    // =========================================================================
    // HEADER
    // =========================================================================

    /** Standard screen header row */
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: layout.screenPadding,
      paddingVertical: spacing.md,
    },

    /** Header title text */
    headerTitle: {
      ...typography.cardTitle,
      color: isDark ? darkColors.textPrimary : colors.textPrimary,
    } as TextStyle,

    /** Back button touchable area */
    backButton: {
      padding: spacing.xs,
      marginLeft: -spacing.xs,
    },

    // =========================================================================
    // CARDS & SECTIONS
    // =========================================================================

    /** Standard card with rounded corners */
    card: {
      backgroundColor: isDark ? darkColors.surface : colors.surface,
      borderRadius: layout.borderRadius,
      padding: layout.cardPadding,
    },

    /** Section card with horizontal margins */
    section: {
      backgroundColor: isDark ? darkColors.surface : colors.surface,
      borderRadius: layout.borderRadius,
      padding: layout.cardPadding,
      marginHorizontal: layout.screenPadding,
      marginBottom: spacing.md,
    },

    /** Section title text */
    sectionTitle: {
      ...typography.bodyBold,
      color: isDark ? darkColors.textPrimary : colors.textPrimary,
      marginBottom: spacing.sm,
    } as TextStyle,

    /** Section label (small caps) */
    sectionLabel: {
      ...typography.label,
      color: isDark ? darkColors.textSecondary : colors.textSecondary,
      marginBottom: spacing.xs,
    } as TextStyle,

    // =========================================================================
    // TEXT STYLES
    // =========================================================================

    /** Primary text color */
    text: {
      color: isDark ? darkColors.textPrimary : colors.textPrimary,
    },

    /** Secondary text color */
    textSecondary: {
      color: isDark ? darkColors.textSecondary : colors.textSecondary,
    },

    /** Muted text color */
    textMuted: {
      color: isDark ? darkColors.textMuted : colors.textMuted,
    },

    /** Text on dark backgrounds (always white) */
    textLight: {
      color: colors.textOnDark,
    },

    /** Link text style */
    link: {
      color: isDark ? darkColors.primary : colors.primary,
    },

    // =========================================================================
    // DIVIDERS
    // =========================================================================

    /** Horizontal divider line */
    divider: {
      height: 1,
      backgroundColor: isDark ? darkColors.border : colors.border,
    },

    /** Divider with vertical margin */
    dividerWithMargin: {
      height: 1,
      backgroundColor: isDark ? darkColors.border : colors.border,
      marginVertical: spacing.md,
    },

    // =========================================================================
    // ROW LAYOUTS
    // =========================================================================

    /** Basic row with centered items */
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },

    /** Row with space-between */
    rowSpaceBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },

    /** Row with gap */
    rowWithGap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },

    // =========================================================================
    // TIME RANGE SELECTOR (used in fitness, wellness, stats screens)
    // =========================================================================

    /** Container for time range buttons */
    timeRangeContainer: {
      flexDirection: 'row',
      gap: spacing.xs,
    },

    /** Individual time range button */
    timeRangeButton: {
      paddingHorizontal: spacing.sm + 4,
      paddingVertical: spacing.xs,
      borderRadius: 14,
      backgroundColor: isDark ? darkColors.surface : colors.gray100,
    },

    /** Active time range button */
    timeRangeButtonActive: {
      backgroundColor: isDark ? darkColors.primary : colors.primary,
    },

    /** Time range button text */
    timeRangeText: {
      ...typography.bodyCompact,
      fontWeight: '500',
      color: isDark ? darkColors.textSecondary : colors.textSecondary,
    } as TextStyle,

    /** Active time range button text */
    timeRangeTextActive: {
      ...typography.bodyCompact,
      fontWeight: '500',
      color: isDark ? darkColors.textPrimary : colors.textOnDark,
    } as TextStyle,

    // =========================================================================
    // STAT DISPLAYS
    // =========================================================================

    /** Container for stat item */
    statItem: {
      alignItems: 'center',
    },

    /** Stat value text */
    statValue: {
      ...typography.statsValue,
      color: isDark ? darkColors.textPrimary : colors.textPrimary,
    } as TextStyle,

    /** Stat label text */
    statLabel: {
      ...typography.statsLabel,
      color: isDark ? darkColors.textSecondary : colors.textSecondary,
    } as TextStyle,

    // =========================================================================
    // EMPTY & ERROR STATES
    // =========================================================================

    /** Empty state title */
    emptyTitle: {
      ...typography.cardTitle,
      color: isDark ? darkColors.textPrimary : colors.textPrimary,
      textAlign: 'center',
      marginBottom: spacing.sm,
    } as TextStyle,

    /** Empty state description */
    emptyText: {
      ...typography.body,
      color: isDark ? darkColors.textSecondary : colors.textSecondary,
      textAlign: 'center',
    } as TextStyle,
  });
};

/** Type for the shared styles object */
export type SharedStyles = ReturnType<typeof createSharedStyles>;
