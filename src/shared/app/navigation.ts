import { router, type Href } from 'expo-router';

import * as haptics from '@/shared/ui/haptics';

/**
 * Type-safe navigation wrappers that contain the single `as Href` cast
 * needed for dynamic route paths in Expo Router.
 *
 * Use these instead of `router.push(path as never)` or `router.push(path as Href)`.
 *
 * `navigateTo`, `replaceTo` and `navigateTab` are silent: they serve navigation with no tap behind
 * it (a notification, the end of a recording, a redirect). A press handler that opens a screen or
 * goes back calls `tapTo` or `tapBack`, which fire one light impact first.
 */
export function navigateTo(
  path: string | { pathname: string; params?: Record<string, string | undefined> }
): void {
  router.push(path as Href);
}

export function replaceTo(
  path: string | { pathname: string; params?: Record<string, string | undefined> }
): void {
  router.replace(path as Href);
}

export function navigateTab(
  path: string | { pathname: string; params?: Record<string, string | undefined> }
): void {
  router.navigate(path as Href);
}

/** A tap that opens a screen: one light impact, then the push. */
export function tapTo(
  path: string | { pathname: string; params?: Record<string, string | undefined> }
): void {
  haptics.light();
  navigateTo(path);
}

/** A tap that goes back: one light impact, then the pop. */
export function tapBack(): void {
  haptics.light();
  router.back();
}
