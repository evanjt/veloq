/**
 * The screen under the user. A sheet in `src/app/sheets/` is pushed as a route over the screen
 * that opened it, so while one is presented the pathname is the sheet's and the screen on display
 * is still the one it covers. A view that asks whether its own screen is showing reads the path
 * here, never the raw pathname, or every sheet counts as leaving that screen.
 */
import { useState } from 'react';
import { usePathname } from 'expo-router';

export function isSheetPath(pathname: string): boolean {
  return pathname.startsWith('/sheets/');
}

/**
 * The path of the screen on display: the pathname itself, or under a sheet the last path that was
 * not one. A view mounted while a sheet is already up has seen nothing under it and reads the
 * sheet's path.
 */
export function screenPathUnder(pathname: string, lastScreen: string | null): string {
  return isSheetPath(pathname) && lastScreen !== null ? lastScreen : pathname;
}

/** The pathname of the screen on display, held through any sheet presented over it. */
export function useScreenPathname(): string {
  const pathname = usePathname();
  const [lastScreen, setLastScreen] = useState<string | null>(null);
  if (!isSheetPath(pathname) && pathname !== lastScreen) setLastScreen(pathname);
  return screenPathUnder(pathname, lastScreen);
}
