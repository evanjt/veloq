import { Platform, ViewStyle } from 'react-native';

/**
 * Platform-specific shadow utilities for iOS optimization.
 *
 * iOS renders shadows differently than Android's elevation system:
 * - iOS uses Core Animation shadows (shadowColor, shadowOffset, shadowOpacity, shadowRadius)
 * - Android uses Material Design elevation
 * - iOS shadow opacity needs to be ~1.5-2x stronger to achieve visual parity with Android elevation
 */

type ShadowStyle = Pick<ViewStyle,
  | 'shadowColor'
  | 'shadowOffset'
  | 'shadowOpacity'
  | 'shadowRadius'
  | 'elevation'
>;

/**
 * Creates platform-optimized shadow styles.
 * iOS shadows are boosted for better visibility on physical devices.
 */
export function createShadow(
  elevation: number,
  options?: {
    /** Custom shadow color (default: #000) */
    color?: string;
    /** iOS opacity multiplier (default: 1.5) */
    iosOpacityMultiplier?: number;
  }
): ShadowStyle {
  const { color = '#000', iosOpacityMultiplier = 1.5 } = options ?? {};

  // Map elevation to shadow properties
  // Based on Material Design elevation to iOS shadow mapping
  const shadowRadius = elevation * 0.8;
  const shadowOffset = { width: 0, height: Math.max(1, elevation * 0.5) };
  const baseOpacity = Math.min(0.3, 0.03 + elevation * 0.02);

  return Platform.select({
    ios: {
      shadowColor: color,
      shadowOffset,
      shadowOpacity: baseOpacity * iosOpacityMultiplier,
      shadowRadius,
    },
    android: {
      elevation,
    },
    default: {
      shadowColor: color,
      shadowOffset,
      shadowOpacity: baseOpacity,
      shadowRadius,
    },
  }) as ShadowStyle;
}

/**
 * Pre-defined shadow presets for common UI elements.
 * Optimized for both iOS and Android visual parity.
 */
export const shadows = {
  /** Subtle shadow for cards and containers (elevation 2) */
  card: createShadow(2),

  /** Medium shadow for floating elements (elevation 4) */
  elevated: createShadow(4),

  /** Strong shadow for modals and overlays (elevation 8) */
  modal: createShadow(8),

  /** Small shadow for buttons and chips (elevation 2) */
  button: createShadow(2, { iosOpacityMultiplier: 1.8 }),

  /** FAB shadow (elevation 6) */
  fab: createShadow(6, { iosOpacityMultiplier: 1.6 }),

  /** Pill/badge shadow - very subtle (elevation 1) */
  pill: createShadow(1, { iosOpacityMultiplier: 2 }),

  /** Map overlay shadow (elevation 3) */
  mapOverlay: createShadow(3, { iosOpacityMultiplier: 1.8 }),

  /** None - explicitly no shadow */
  none: Platform.select({
    ios: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
    },
    android: {
      elevation: 0,
    },
    default: {},
  }) as ShadowStyle,
};

/**
 * Creates shadow styles for a specific card with custom opacity.
 * Use this when the preset shadows don't fit your needs.
 */
export function cardShadow(opacity: number = 0.1): ShadowStyle {
  return Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: opacity * 1.5, // Boost for iOS visibility
      shadowRadius: 12,
    },
    android: {
      elevation: 4,
    },
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: opacity,
      shadowRadius: 12,
    },
  }) as ShadowStyle;
}

/**
 * Creates shadow for small interactive elements like handles and buttons.
 */
export function smallElementShadow(): ShadowStyle {
  return Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    android: {
      elevation: 4,
    },
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
    },
  }) as ShadowStyle;
}
