/**
 * The screen an athlete asked for on the way in, opened once the root layout
 * has taken them to the tabs.
 *
 * The sign-in screen starts a session and the root layout decides when it
 * is safe to leave it, after the library's identity is settled. A button that
 * names a destination leaves it here rather than navigating, so the tab group
 * is under the screen when it opens and back returns to it.
 */

let pending: string | null = null;

export function setPostEntryRoute(route: string | null): void {
  pending = route;
}

/** The destination, once. A second call finds none. */
export function takePostEntryRoute(): string | null {
  const route = pending;
  pending = null;
  return route;
}
