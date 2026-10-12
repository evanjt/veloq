/**
 * The one owner of the bottom edge: where the tab bar draws, and how far a view that meets the
 * bottom of the screen stays clear of it and of the system navigation bar or home indicator.
 *
 * The bar reads `isTabBarRoute` to decide whether to draw. A view whose bottom is the screen's,
 * such as a control bar, a sheet or a floating button, reads `useBottomClearance`. A scroll view
 * reads `useScrollEndInset`, which `ScreenScrollView` adds on its own. No other place reads the
 * bottom inset for padding, so the inset is cleared once, and a screen the tab bar does not cover
 * never gives content away to it.
 */
import { createContext, useContext } from 'react';
import { Platform } from 'react-native';
import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/theme';

// Dimensions
export const TAB_BAR_HEIGHT = 60; // Height for icons + labels
export const GRADIENT_HEIGHT = 20; // Small fade zone above icons
export const TAB_BAR_SAFE_PADDING = TAB_BAR_HEIGHT + GRADIENT_HEIGHT; // Total padding for content

/**
 * Set by a safe area view that pads the bottom edge, so nothing inside it adds the inset again.
 * A screen that reads a clearance above the safe area it renders cannot see this, and says so
 * with `{ insetTaken: true }` instead. An absolutely positioned view inside one is not lifted by
 * its padding, and says `{ insetTaken: false }`.
 */
export const BottomInsetTaken = createContext(false);

/**
 * Stack screens own their whole bottom edge, so the bar draws only inside the tabs group. Reading
 * the group, not a pathname list, covers a new stack screen unedited.
 */
export function isTabBarRoute(segments: readonly string[]): boolean {
  return segments[0] === '(tabs)';
}

/**
 * How far a view whose bottom is the screen's bottom stays clear of it: the tab bar and the inset
 * it draws over on a tab screen, and elsewhere the inset with a floor, so a control keeps a margin
 * from the edge on a phone that reports none. What a safe area above already took is subtracted.
 */
export function bottomClearance(onTabs: boolean, inset: number, insetTaken: boolean): number {
  const fromEdge = onTabs ? TAB_BAR_SAFE_PADDING + inset : Math.max(inset, spacing.md);
  return fromEdge - (insetTaken ? inset : 0);
}

/**
 * The padding a scroll view's content ends with: the tab bar on a tab screen, and the inset on
 * Android, which insets no scroll view while the app draws edge to edge. iOS insets a scroll view
 * that lets it (`contentInsetAdjustmentBehavior: 'automatic'`) by what it overlaps, so it adds
 * nothing there, and nothing under a safe area that already took the inset.
 */
export function scrollEndInset(
  onTabs: boolean,
  inset: number,
  insetTaken: boolean,
  platform: string
): number {
  const tabBar = onTabs ? TAB_BAR_SAFE_PADDING : 0;
  return tabBar + (platform === 'android' && !insetTaken ? inset : 0);
}

interface ClearanceOptions {
  /** Whether a safe area takes the inset for this view, when the context cannot say. */
  insetTaken?: boolean;
}

/** The bottom padding of a view whose bottom is the screen's, as `bottomClearance` gives it. */
export function useBottomClearance(options: ClearanceOptions = {}): number {
  const segments = useSegments();
  const { bottom } = useSafeAreaInsets();
  const takenAbove = useContext(BottomInsetTaken);
  const insetTaken = options.insetTaken ?? takenAbove;
  return bottomClearance(isTabBarRoute(segments), bottom, insetTaken);
}

/** The padding a scroll view's content ends with, as `scrollEndInset` gives it. */
export function useScrollEndInset(options: ClearanceOptions = {}): number {
  const segments = useSegments();
  const { bottom } = useSafeAreaInsets();
  const takenAbove = useContext(BottomInsetTaken);
  const insetTaken = options.insetTaken ?? takenAbove;
  return scrollEndInset(isTabBarRoute(segments), bottom, insetTaken, Platform.OS);
}

/**
 * The tab bar's height alone, for a view a library already lifts by the inset, such as a
 * snackbar. Anything else reads one of the two above.
 */
export function useTabBarClearance(): number {
  const segments = useSegments();
  return isTabBarRoute(segments) ? TAB_BAR_SAFE_PADDING : 0;
}
