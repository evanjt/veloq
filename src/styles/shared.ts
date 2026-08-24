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
import { StyleSheet, TextStyle } from 'react-native';
import { colors, darkColors, spacing, layout, typography } from '@/theme';

// Two-slot cache: light and dark styles (only 2 possible values of isDark)
let cachedLight: ReturnType<typeof buildSharedStyles> | null = null;
let cachedDark: ReturnType<typeof buildSharedStyles> | null = null;

/**
 * Creates theme-aware shared styles.
 * Call this with isDark from useTheme() to get the correct styles for the current theme.
 * Results are cached per theme (light/dark) to avoid calling StyleSheet.create() every render.
 */
export const createSharedStyles = (isDark: boolean) => {
  if (isDark) {
    if (!cachedDark) cachedDark = buildSharedStyles(true);
    return cachedDark;
  }
  if (!cachedLight) cachedLight = buildSharedStyles(false);
  return cachedLight;
};

const buildSharedStyles = (isDark: boolean) => {
  return StyleSheet.create({
    // =========================================================================
    // LAYOUT CONTAINERS
    // =========================================================================

    /** Full-screen container with theme background */
    container: {
      flex: 1,
      backgroundColor: isDark ? darkColors.background : colors.background,
    },

    /** ScrollView content container with standard padding */
    scrollContent: {
      paddingHorizontal: layout.screenPadding,
      paddingBottom: spacing.xl,
    },

    /** Loading container with centered spinner */
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDark ? darkColors.background : colors.background,
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
  });
};

/** Type for the shared styles object */
export type SharedStyles = ReturnType<typeof buildSharedStyles>;
