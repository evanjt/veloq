// The page's stand-in for the app barrel: the theme hook alone, driven by the browser's scheme.
import { useSyncExternalStore } from 'react';
import { brand, colors, darkColors, themePalette } from '@/theme';

const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const subscribe = (fn: () => void) => {
  query?.addEventListener('change', fn);
  return () => query?.removeEventListener('change', fn);
};
export function useResolvedColorScheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    subscribe,
    () => (query?.matches ? 'dark' : 'light'),
    () => 'light'
  );
}
export function useTheme() {
  const isDark = useResolvedColorScheme() === 'dark';
  const palette = themePalette(isDark);
  const scheme = isDark ? darkColors : colors;
  const c = {
    primary: palette.actionPrimary,
    primaryDark: palette.actionPrimaryHover,
    primaryLight: palette.actionSecondary,
    secondary: brand.blue,
    secondaryDark: brand.blueDark,
    secondaryLight: brand.blueLight,
    background: scheme.surfacePage,
    surface: scheme.surface,
    card: isDark ? darkColors.surfaceRaised : colors.surface,
    text: scheme.textPrimary,
    textSecondary: scheme.textSecondary,
    success: scheme.success,
    error: scheme.error,
    warning: scheme.warning,
    border: scheme.border,
    divider: scheme.border,
    fitness: scheme.fitness,
    fatigue: scheme.fatigue,
  };
  return {
    isDark,
    preferOpaqueChrome: false,
    colors: c,
    palette,
    styles: {
      container: { backgroundColor: c.background },
      card: { backgroundColor: c.card },
      text: { color: c.text },
      textSecondary: { color: c.textSecondary },
    },
  };
}
