// What the command palette and the page's key chords decide without a screen:
// which press opens the palette, which digit or letter after `g` jumps to which
// page, how a typed query ranks the entries, how the hits fall into groups and
// which items were opened last. Pure, so a test drives it without a browser.

import { NAV, type NavKey } from './pages';
import { inField, type Press, type Route } from './router';
import { withFilterText } from './ui/filterText';

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

const NAV_ENTRIES = NAV.flatMap((group) => group.entries);

/** The letter pressed after `g` and the page it goes to, read from the sidebar's table. */
export const CHORDS: Readonly<Record<string, NavKey>> = Object.fromEntries(
  NAV_ENTRIES.map((entry) => [entry.chord, entry.key])
);

/** The digit that goes to each sidebar page: 1 to 9 in the sidebar's order, then 0 for the tenth. */
export function digitOf(index: number): string {
  return String((index + 1) % 10);
}

/** The page a digit goes to, in the sidebar's order, or null. */
export function digitTarget(digit: string): NavKey | null {
  return NAV_ENTRIES.find((_, index) => digitOf(index) === digit)?.key ?? null;
}

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
export function chordStep(
  press: Press,
  armed: boolean,
  shortcuts = true
): { armed: boolean; page: NavKey | null } {
  if (!shortcuts || press.ctrlKey || press.metaKey || press.altKey || inField(press.target)) {
    return { armed: false, page: null };
  }
  if (armed) {
    const page = chordTarget(press.key);
    if (page) return { armed: false, page };
  }
  return { armed: press.key === 'g', page: null };
}

/** What the palette searches, in the order its groups are drawn. */
export type Kind =
  | 'page'
  | 'action'
  | 'setting'
  | 'activity'
  | 'route'
  | 'section'
  | 'exercise'
  | 'workout'
  | 'recording';

export const KIND_ORDER: readonly Kind[] = [
  'page',
  'action',
  'setting',
  'activity',
  'route',
  'section',
  'exercise',
  'workout',
  'recording',
];

/** The most hits one group shows before it offers the whole list. */
export const PER_GROUP = 5;

export type Group<T> = {
  kind: Kind;
  hits: T[];
  /** How many the kind holds for the query: the list's own count when it reports one. */
  total: number;
  /** True when the group holds more than it shows, so a show-all row follows it. */
  showAll: boolean;
};

/**
 * The hits as groups in the fixed kind order, each holding at most
 * `PER_GROUP`. `totals` carries a count a list reported for its kind, which
 * can exceed the hits it was asked for.
 */
export function groupResults<T extends { kind: Kind }>(
  hits: readonly T[],
  totals: Readonly<Partial<Record<Kind, number>>>
): Group<T>[] {
  return KIND_ORDER.flatMap((kind) => {
    const own = hits.filter((hit) => hit.kind === kind);
    if (own.length === 0) return [];
    const total = Math.max(totals[kind] ?? 0, own.length);
    return [{ kind, hits: own.slice(0, PER_GROUP), total, showAll: total > PER_GROUP }];
  });
}

/** The list a kind's show-all row opens with the typed text as its filter, or null for a kind that is not a list. */
export function showAllRoute(kind: Kind, text: string): Route | null {
  const screen = (
    {
      activity: 'activities',
      route: 'routes',
      section: 'sections',
      exercise: 'strength',
      workout: 'workouts',
      recording: 'recordings',
    } as const
  )[kind as 'activity'];
  return screen ? withFilterText({ screen, id: null, query: [] }, text) : null;
}

/** An item the athlete opened from the palette, kept to offer first the next time. */
export type Recent = { id: string; kind: Kind; label: string; route: Route };

/** How many recent items are kept. */
export const RECENT_LIMIT = 5;

/** The list with the item first, once, cut to `RECENT_LIMIT`. */
export function remember(list: readonly Recent[], item: Recent): Recent[] {
  return [item, ...list.filter((entry) => entry.id !== item.id)].slice(0, RECENT_LIMIT);
}

function isRecent(value: unknown): value is Recent {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  const route = entry.route as Record<string, unknown> | null | undefined;
  return (
    typeof entry.id === 'string' &&
    typeof entry.label === 'string' &&
    KIND_ORDER.includes(entry.kind as Kind) &&
    typeof route === 'object' &&
    route !== null &&
    typeof route.screen === 'string' &&
    Array.isArray(route.query)
  );
}

/** The recent items in kept text; text that is not a list of them reads as none. */
export function parseRecent(raw: string | null): Recent[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isRecent).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}
