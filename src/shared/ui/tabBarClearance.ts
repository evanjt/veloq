/**
 * Where the bottom tab bar draws, and how much room a screen leaves for it.
 *
 * The bar reads `isTabBarRoute` to decide whether to draw, and every screen that pads for the bar
 * reads `useTabBarClearance`, so a screen the bar does not cover never gives content away to it.
 */
import { useSegments } from 'expo-router';

// Dimensions
export const TAB_BAR_HEIGHT = 60; // Height for icons + labels
export const GRADIENT_HEIGHT = 20; // Small fade zone above icons
export const TAB_BAR_SAFE_PADDING = TAB_BAR_HEIGHT + GRADIENT_HEIGHT; // Total padding for content

/**
 * Stack screens own their whole bottom edge, so the bar draws only inside the tabs group. Reading
 * the group, not a pathname list, covers a new stack screen unedited.
 */
export function isTabBarRoute(segments: readonly string[]): boolean {
  return segments[0] === '(tabs)';
}

/** The bottom padding that clears the tab bar on this screen: the bar's height, or 0 without it. */
export function useTabBarClearance(): number {
  const segments = useSegments();
  return isTabBarRoute(segments) ? TAB_BAR_SAFE_PADDING : 0;
}
