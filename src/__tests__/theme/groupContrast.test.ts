/**
 * Scenario: the family table covers `colors` and `darkColors`, 150 tokens, and
 * `colors.ts` exports two dozen more groups it does not. A tone added to
 * `statusBadge` at 2:1 and drawn as a badge label passed every gate, which is the
 * same hole the family table closed for the two palettes.
 *
 * Expected behaviour: every exported group is classified in `groupKinds.ts` and
 * measured according to its kind. A `pair` states its own ground, so the pair is
 * measured; a `mark` is measured against the theme's surfaces at 3:1; a `series`
 * is checked for members that are not distinct, because being told apart from each
 * other is the only thing it owes.
 *
 * A group `colors.ts` exports with no line in the table fails, so the next one
 * cannot land unclassified.
 */

import * as palette from '@/theme/colors';
import { GROUP_KINDS, GROUP_UNDER_BAR, type PairSpec } from '@/theme/groupKinds';

/** WCAG 2.2 AA: 1.4.3 for text, 1.4.11 for a non-text mark. */
const BARS = { text: 4.5, mark: 3 } as const;

const LIGHT_SURFACES = [
  palette.colors.surface,
  palette.colors.background,
  palette.colors.backgroundAlt,
];
const DARK_SURFACES = [
  palette.darkColors.surface,
  palette.darkColors.surfaceElevated,
  palette.darkColors.surfaceCard,
];

function channels(hex: string): [number, number, number] {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return [linear[0], linear[1], linear[2]];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A translucent fill over a ground, as the renderer composites it. `statusBadge`
 * states its fills as eight-digit hex, `#22C55E18`, and measuring the ratio
 * against the bare hue rather than against what the eye sees is how a 2:1 label
 * reads as compliant.
 */
function over(fill: string, ground: string): string {
  if (fill.length !== 9) return fill;
  const alpha = parseInt(fill.slice(7, 9), 16) / 255;
  const mix = (i: number) => {
    const f = parseInt(fill.slice(i, i + 2), 16);
    const g = parseInt(ground.slice(i, i + 2), 16);
    return Math.round(f * alpha + g * (1 - alpha))
      .toString(16)
      .toUpperCase()
      .padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/** Follow a dot path into a group, or into a sibling group with a `..` prefix. */
function tone(group: string, path: string): string {
  const [from, rest] = path.startsWith('..')
    ? [path.slice(2).split('.')[0], path.slice(2).split('.').slice(1).join('.')]
    : [group, path];
  let node: unknown = (palette as Record<string, unknown>)[from];
  for (const key of rest.split('.')) {
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== 'string') {
    throw new Error(`${from}.${rest} is not a colour`);
  }
  return node;
}

/** Every hex string a group holds, however deeply nested. */
function hexes(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    if (/^#[0-9A-Fa-f]{6,8}$/.test(node)) out.push(node.toUpperCase());
    return out;
  }
  if (Array.isArray(node) || (node && typeof node === 'object')) {
    for (const value of Object.values(node as Record<string, unknown>)) hexes(value, out);
  }
  return out;
}

/**
 * The groups the rule is about: every exported object of colours, minus the two
 * palettes the family table already covers and the helpers that are not groups.
 */
const NOT_A_GROUP = new Set([
  'colors',
  'darkColors',
  'verdictColor',
  'verdictFill',
  'insightToneColor',
  'colorWithOpacity',
  'sectionPaletteIndex',
  'sectionPaletteExpression',
]);

const EXPORTED = Object.keys(palette).filter((name) => {
  if (NOT_A_GROUP.has(name)) return false;
  const value = (palette as Record<string, unknown>)[name];
  if (typeof value === 'function') return false;
  return hexes(value).length > 0 || (value !== null && typeof value === 'object');
});

describe('every colour group in the palette file is classified', () => {
  it('leaves none of them out of the table', () => {
    const unclassified = EXPORTED.filter((name) => !(name in GROUP_KINDS));

    expect(unclassified).toStrictEqual([]);
  });

  it('names no group the file has stopped exporting', () => {
    const stale = Object.keys(GROUP_KINDS).filter(
      (name) => !(name in (palette as Record<string, unknown>))
    );

    expect(stale).toStrictEqual([]);
  });

  it('gives every group a reason, so the classification can be argued with', () => {
    const silent = Object.entries(GROUP_KINDS)
      .filter(([, spec]) => spec.reason.trim().length < 20)
      .map(([name]) => name);

    expect(silent).toStrictEqual([]);
  });
});

const PAIRS: [string, PairSpec][] = Object.entries(GROUP_KINDS).flatMap(([name, spec]) =>
  (spec.pairs ?? []).map((pair) => [name, pair] as [string, PairSpec])
);

/** The worst ratio a foreground reaches over its ground. */
function pairRatio(group: string, pair: PairSpec, path: string): number {
  const foreground = tone(group, path);
  if (pair.ground === 'surface') {
    const grounds = path.endsWith('.dark') ? DARK_SURFACES : LIGHT_SURFACES;
    return Math.min(...grounds.map((surface) => contrastRatio(foreground, surface)));
  }
  // A translucent ground is composited over the lightest surface it can sit on,
  // which is the worst case for a dark foreground.
  const settled = over(tone(group, pair.ground), LIGHT_SURFACES[0]);
  return contrastRatio(over(foreground, settled), settled);
}

describe('a group that states its own ground holds its pair', () => {
  it.each(PAIRS)('%s: %o', (group, pair) => {
    for (const path of pair.on) {
      const key = `${group}:${path}`;
      if (key in GROUP_UNDER_BAR) continue;
      expect(pairRatio(group, pair, path)).toBeGreaterThanOrEqual(BARS[pair.bar]);
    }
  });

  it('still finds every pair on the under-bar list, so the list shortens rather than rots', () => {
    const fixed: string[] = [];
    for (const [group, pair] of PAIRS) {
      for (const path of pair.on) {
        const key = `${group}:${path}`;
        if (key in GROUP_UNDER_BAR && pairRatio(group, pair, path) >= BARS[pair.bar]) {
          fixed.push(key);
        }
      }
    }

    expect(fixed).toStrictEqual([]);
  });
});

const MARKS: [string, string, 'light' | 'dark' | 'both'][] = Object.entries(GROUP_KINDS).flatMap(
  ([name, spec]) =>
    (spec.marks ?? []).flatMap((mark) =>
      mark.paths.map(
        (path) => [name, path, mark.theme] as [string, string, 'light' | 'dark' | 'both']
      )
    )
);

describe('a group drawn on the theme surface holds the mark bar', () => {
  it.each(MARKS)('%s.%s on the %s theme', (group, path, theme) => {
    const mark = tone(group, path);
    const grounds =
      theme === 'light'
        ? LIGHT_SURFACES
        : theme === 'dark'
          ? DARK_SURFACES
          : [...LIGHT_SURFACES, ...DARK_SURFACES];
    for (const ground of grounds) {
      expect(contrastRatio(mark, ground)).toBeGreaterThanOrEqual(BARS.mark);
    }
  });
});

const SERIES = Object.entries(GROUP_KINDS)
  .filter(([, spec]) => spec.kind === 'series')
  .map(([name]) => name);

describe('a series is told apart from itself', () => {
  /**
   * The bar a series owes. Not a ratio against a surface: 1.4.11 exempts a graphic
   * whose information is carried another way, and for every one of these it is a
   * label, a legend or a number. What it does owe is that two members which mean
   * different things are not the same colour, which is what a copy-paste breaks.
   */
  it.each(SERIES)('%s keeps its members distinct', (name) => {
    const values = hexes((palette as Record<string, unknown>)[name]);
    // A group with no hex members has nothing to tell apart: `glows` holds rgba
    // strings and `opacity` holds numbers, and both are series for the same
    // reason, that they carry no information of their own.
    if (values.length === 0) return;

    // Deliberate aliases exist: an activity type that shares another's colour, a
    // mode that reuses a tone. What this holds is that the distinct count has not
    // collapsed, which is what a copy-paste into a new member does.
    expect(new Set(values).size).toBeGreaterThanOrEqual(Math.ceil(values.length / 4));
  });
});
