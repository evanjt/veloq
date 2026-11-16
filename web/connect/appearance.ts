// The page's colour scheme: system, light or dark, kept in this browser. The
// choice is written to the page root as `data-theme`, which the colour tokens
// and the page's native colour-scheme follow. A reader that draws once, such as
// a map base, asks `isDarkScheme`, so the choice has one reader in code.

import { useCallback, useEffect, useState } from 'react';

/** Where the browser keeps the choice. */
export const THEME_KEY = 'veloq-connect-theme';

export type ThemeChoice = 'system' | 'light' | 'dark';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** The choice the browser kept, or the system choice when none is kept or storage is refused. */
export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function keepTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage that is blocked leaves the choice for this visit only.
  }
}

/** Whether the operating system asks for a dark scheme. */
export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Whether the page is drawn dark for a choice, given what the system asks for. */
export function schemeIsDark(choice: ThemeChoice, systemDark: boolean): boolean {
  if (choice === 'system') return systemDark;
  return choice === 'dark';
}

/** Whether the page is drawn dark now, from the browser's choice and the system's. */
export function isDarkScheme(): boolean {
  return schemeIsDark(readTheme(), systemPrefersDark());
}

/** The choice the palette's toggle sets: the opposite of the scheme the page shows now. */
export function flipTheme(choice: ThemeChoice, systemDark: boolean): ThemeChoice {
  return schemeIsDark(choice, systemDark) ? 'light' : 'dark';
}

/** Sets the choice on the page root, where the tokens read it. */
export function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.theme = choice;
}

/**
 * The page's choice and the setter that keeps it in the browser and applies it.
 * The choice starts from the browser's kept value, so a visit opens as it was left.
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const choose = useCallback((choice: ThemeChoice) => {
    keepTheme(choice);
    setTheme(choice);
  }, []);
  return [theme, choose];
}
