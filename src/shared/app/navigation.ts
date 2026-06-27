import { router, type Href } from 'expo-router';

/**
 * Type-safe navigation wrappers that contain the single `as Href` cast
 * needed for dynamic route paths in Expo Router.
 *
 * Use these instead of `router.push(path as never)` or `router.push(path as Href)`.
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
