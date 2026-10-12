import type { ReactNode } from 'react';
import { ThemeProvider } from 'expo-router';

import { navigationTheme } from '@/theme/navigationTheme';
import { useResolvedColorScheme } from './ThemeProvider';

/** Hands the navigators the theme for the scheme the app resolved, in-app preference included. */
export function NavigationThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useResolvedColorScheme();
  return <ThemeProvider value={navigationTheme(scheme)}>{children}</ThemeProvider>;
}
