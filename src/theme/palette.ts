import { colors, darkColors } from './colors';

/**
 * Every role both themes define, resolved for one of them. A style that reads
 * its colour from here cannot fall back to the light value in the dark theme by
 * leaving a branch out, which is what a static `colors.<role>` does.
 */
export type Palette = { readonly [K in keyof typeof colors & keyof typeof darkColors]: string };

export function themePalette(isDark: boolean): Palette {
  return isDark ? darkColors : colors;
}

const built = new WeakMap<object, { light?: unknown; dark?: unknown }>();

/**
 * The styles `make` builds from the active theme's palette, built once per theme
 * and kept, so a component calling this on every render allocates nothing.
 */
export function themedStyles<T>(
  make: (palette: Palette, isDark: boolean) => T,
  isDark: boolean
): T {
  let entry = built.get(make);
  if (!entry) {
    entry = {};
    built.set(make, entry);
  }
  const key = isDark ? 'dark' : 'light';
  if (!(key in entry)) entry[key] = make(themePalette(isDark), isDark);
  return entry[key] as T;
}
