import { router, type Href } from 'expo-router';

/**
 * Type-safe navigation wrappers that contain the single `as Href` cast
 * needed for dynamic route paths in Expo Router.
 *
 * Use these instead of `router.push(path as never)` or `router.push(path as Href)`.
 *
 * No navigation fires a haptic, since a press that only navigates is never felt. A press handler
 * that opens a screen or goes back calls `tapTo` or `tapBack`; `navigateTo`, `replaceTo`,
 * `returnTo` and `navigateTab` serve navigation with no tap behind it (a notification, the end of
 * a recording, a redirect).
 *
 * Every back goes through `goBack`. A screen a cold link or a replace left as the stack root has
 * nothing to pop, and `router.back()` there dispatches an action nothing handles, so the control
 * does nothing. A back always leaves the screen, so with no history it goes to the Feed.
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

/**
 * Ends a flow at `path`: pops back to it when it is in history, so nothing the flow pushed stays
 * beneath it, and replaces the current screen with it when it is not.
 */
export function returnTo(path: string): void {
  router.dismissTo(path as Href);
}

export function navigateTab(
  path: string | { pathname: string; params?: Record<string, string | undefined> }
): void {
  router.navigate(path as Href);
}

/** A tap that opens a screen: the push, with no haptic. */
export function tapTo(
  path: string | { pathname: string; params?: Record<string, string | undefined> }
): void {
  navigateTo(path);
}

/** Leaves the screen: pops when there is history, otherwise replaces to the Feed. */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** A tap that goes back: the pop, with no haptic. */
export function tapBack(): void {
  goBack();
}
