import { Platform, TextStyle, ViewStyle } from 'react-native';

import { darkColors, ink } from './colors';
import { stroke } from './stroke';

export const mapTextShadow: Pick<TextStyle, 'textShadowOffset' | 'textShadowRadius'> = {
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
};

/**
 * The halo behind a chart label that crosses the plot, such as a reference
 * rule's name on its line: 3px of the surface colour, set as `textShadowColor`
 * by the chart, so the marks under the label do not run through it.
 */
export const chartLabelHalo: Pick<TextStyle, 'textShadowOffset' | 'textShadowRadius'> = {
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 3,
};

/**
 * Platform-specific shadow utilities for iOS optimisation.
 *
 * iOS renders shadows differently than Android's elevation system:
 * - iOS uses Core Animation shadows (shadowColor, shadowOffset, shadowOpacity, shadowRadius)
 * - Android uses Material Design elevation
 * - iOS shadow opacity needs to be ~1.5-2x stronger to achieve visual parity with Android elevation
 */

type ShadowStyle = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

/**
 * Creates platform-optimised shadow styles.
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
  const { color = ink.black, iosOpacityMultiplier = 1.5 } = options ?? {};

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
 * Optimised for both iOS and Android visual parity.
 */
export const shadows = {
  /** Subtle shadow for cards and containers (elevation 2) */
  card: createShadow(2),

  /** Medium shadow for floating elements (elevation 4) */
  elevated: createShadow(4),

  /** Strong shadow for modals and overlays (elevation 8) */
  modal: createShadow(8),

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

/** The presets a raised surface reads through `raised`. */
export type RaisedLevel = 'card' | 'elevated' | 'modal' | 'pill' | 'mapOverlay' | 'fab';

type RaisedStyle = ShadowStyle & Pick<ViewStyle, 'borderWidth' | 'borderColor'>;

const cardEdge = { borderWidth: stroke.one, borderColor: darkColors.cardEdge };

const raisedStyles: Record<'light' | 'dark', Record<RaisedLevel, RaisedStyle>> = {
  light: {
    card: shadows.card,
    elevated: shadows.elevated,
    modal: shadows.modal,
    pill: shadows.pill,
    mapOverlay: shadows.mapOverlay,
    fab: shadows.fab,
  },
  // A shadow does not read on the near-black dark ground. A card that sits in
  // the page swaps it for the card edge; anything that floats over content
  // keeps its shadow and adds the same edge, so it still lifts off a map.
  dark: {
    card: { ...shadows.none, ...cardEdge },
    elevated: { ...shadows.elevated, ...cardEdge },
    modal: { ...shadows.modal, ...cardEdge },
    pill: { ...shadows.pill, ...cardEdge },
    mapOverlay: { ...shadows.mapOverlay, ...cardEdge },
    fab: { ...shadows.fab, ...cardEdge },
  },
};

/**
 * The elevation of a raised surface in one theme: the shadow preset in light,
 * and in dark the edge that replaces or joins it. The one place the dark rule
 * is written, so no surface spreads a preset and leaves the dark branch out.
 */
export function raised(level: RaisedLevel, isDark: boolean): RaisedStyle {
  return raisedStyles[isDark ? 'dark' : 'light'][level];
}

/**
 * Creates shadow for small interactive elements like handles and buttons.
 */
export function smallElementShadow(): ShadowStyle {
  return Platform.select({
    ios: {
      shadowColor: ink.black,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    android: {
      elevation: 4,
    },
    default: {
      shadowColor: ink.black,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
    },
  }) as ShadowStyle;
}
