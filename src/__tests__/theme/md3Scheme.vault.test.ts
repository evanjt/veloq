/**
 * Scenario: Paper's Material 3 components read roles the app never set, such
 * as the snackbar's inverse surface and action label, a text input's outline
 * and label, and a raised surface's elevation tint. A role left out of the
 * theme falls through to the library's purple baseline.
 *
 * Expected behaviour: in both themes every role the baseline defines,
 * elevation levels included, carries a value of the app's own. A role may
 * equal the baseline only where that value is pure black, pure white or
 * transparent, which carry no hue: shadow, scrim, the ground elevation level
 * and white ink on a dark fill.
 */

import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

import { darkTheme, lightTheme } from '@/theme/index';

type Rgba = [number, number, number, number];

function parse(value: string): Rgba {
  if (value === 'transparent') return [0, 0, 0, 0];
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const fn = value.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const [r, g, b, a = 1] = fn[1].split(',').map((part) => Number(part.trim()));
    return [r, g, b, a];
  }
  throw new Error(`unparsed colour ${value}`);
}

function flatten(colors: object, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === 'string') out[`${prefix}${key}`] = value;
    else Object.assign(out, flatten(value as object, `${prefix}${key}.`));
  }
  return out;
}

function isAchromatic(value: string): boolean {
  const [r, g, b, a] = parse(value);
  return a === 0 || (r === g && g === b && (r === 0 || r === 255));
}

const same = (a: string, b: string) => JSON.stringify(parse(a)) === JSON.stringify(parse(b));

const THEMES = [
  ['light', lightTheme.colors, MD3LightTheme.colors],
  ['dark', darkTheme.colors, MD3DarkTheme.colors],
] as const;

describe.each(THEMES)('the %s Paper scheme', (_name, ours, baseline) => {
  const own = flatten(ours);
  const base = flatten(baseline);

  it('sets every role the baseline defines', () => {
    expect(Object.keys(base).filter((role) => !(role in own))).toEqual([]);
  });

  it('leaves no chromatic role at the baseline value', () => {
    const leaked = Object.keys(base).filter(
      (role) => !isAchromatic(base[role]) && same(own[role], base[role])
    );

    expect(leaked).toEqual([]);
  });

  it('tells a tinted baseline grey from a pure one', () => {
    expect(isAchromatic(base.surface)).toBe(false);
    expect(isAchromatic(base.shadow)).toBe(true);
  });
});
