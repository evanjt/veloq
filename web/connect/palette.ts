// What the command palette and the page's key chords decide without a screen:
// which press opens the palette, which letter after `g` jumps to which page,
// and how a typed query ranks the entries. Pure, so a test drives it without a
// browser.

import { NAV, type NavKey } from './pages';
import { inField, type Press } from './router';

export type PaletteKeyPress = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
};

/** Ctrl+K or Cmd+K. It opens from a text field too, since no text uses that chord. */
export function isPaletteKey(press: PaletteKeyPress): boolean {
  return (
    (press.ctrlKey === true || press.metaKey === true) &&
    press.altKey !== true &&
    press.key.toLowerCase() === 'k'
  );
}

/** The letter pressed after `g` and the page it goes to. */
export const CHORDS: Readonly<Record<string, NavKey>> = {
  f: 'feed',
  m: 'map',
  r: 'routes',
  s: 'sections',
  t: 'fitness',
  i: 'insights',
  x: 'strength',
  w: 'workouts',
  d: 'recordings',
  c: 'settings',
};

/** How long the letter after `g` may take, in milliseconds. */
export const CHORD_WINDOW_MS = 1000;

/** The page a letter after `g` jumps to, or null. */
export function chordTarget(letter: string): NavKey | null {
  return CHORDS[letter] ?? null;
}

/** The address of a sidebar page. */
export function pageHref(key: NavKey): string {
  for (const group of NAV) {
    const entry = group.entries.find((candidate) => candidate.key === key);
    if (entry) return entry.href;
  }
  return '#/feed';
}

/** Scores from here up are scattered matches, not a prefix or a run of the label. */
export const LOOSE = 2000;

/**
 * How well `query` matches `label`, or null when it does not. Every query
 * character has to appear in order. A match at the start scores best, then one
 * inside a word, then a scattered one; a tighter match beats a looser one.
 */
export function score(label: string, query: string): number | null {
  const text = label.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (needle === '') return 0;
  const at = text.indexOf(needle);
  if (at === 0) return 0;
  if (at > 0) return 1000 + at;
  let from = 0;
  let first = -1;
  for (const char of needle) {
    const found = text.indexOf(char, from);
    if (found < 0) return null;
    if (first < 0) first = found;
    from = found + 1;
  }
  return LOOSE + (from - first) * 10 + first;
}

/** The items the query matches, best first; an empty query keeps them as given. */
export function rank<T extends { label: string }>(items: readonly T[], query: string): T[] {
  if (query.trim() === '') return [...items];
  return items
    .map((item, order) => ({ item, order, at: score(item.label, query) }))
    .filter((entry): entry is { item: T; order: number; at: number } => entry.at !== null)
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((entry) => entry.item);
}

/**
 * One key press in the `g` then letter chord. `armed` says whether `g` was
 * pressed just before. The result says whether the next press continues the
 * chord and which page, if any, the press goes to.
 */
export function chordStep(press: Press, armed: boolean): { armed: boolean; page: NavKey | null } {
  if (press.ctrlKey || press.metaKey || press.altKey || inField(press.target)) {
    return { armed: false, page: null };
  }
  if (armed) {
    const page = chordTarget(press.key);
    if (page) return { armed: false, page };
  }
  return { armed: press.key === 'g', page: null };
}
