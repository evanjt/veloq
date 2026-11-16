// The connect page's address: `location.hash` read and written as a path and a
// query, the paths one for one with the phone's own. Pure, so a test drives it
// without a browser.

/** The tabs in the phone's order. */
export const TABS = ['feed', 'fitness', 'insights', 'map', 'settings'] as const;

export type Tab = (typeof TABS)[number];

/** Paths that take no identifier, and the tab each belongs to. */
const PLAIN: Record<string, Tab> = {
  activities: 'feed',
  map: 'map',
  routes: 'map',
  sections: 'map',
  fitness: 'fitness',
  insights: 'insights',
  strength: 'insights',
  'best-efforts': 'insights',
  settings: 'settings',
  recordings: 'feed',
  workouts: 'insights',
  live: 'insights',
};

/** Paths that name one thing, and the tab each belongs to. */
const WITH_ID: Record<string, Tab> = {
  activity: 'feed',
  recording: 'feed',
  route: 'map',
  section: 'map',
  exercise: 'insights',
  workout: 'insights',
};

export type Route = { screen: string; id: string | null; query: [string, string][] };

/** The address the activities page was first given; it opens the same page. */
const RETIRED_ACTIVITIES = 'feed';

export const FEED: Readonly<Route> = Object.freeze({ screen: 'activities', id: null, query: [] });

const decode = (text: string): string | null => {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
};

const feed = (): Route => ({ ...FEED, query: [] });

/** A hash as a route. Anything not a known path is the feed. */
export function parse(hash: string): Route {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, search] = splitOnce(text, '?');
  const parts = path.split('/');
  if (parts[0] !== '' || parts.length < 2) return feed();
  const named = parts[1] ?? '';
  const screen = named === RETIRED_ACTIVITIES ? 'activities' : named;
  const rest = parts.slice(2).map(decode);
  if (rest.includes(null) || rest.length > 1) return feed();
  const id = rest[0] || null;
  if (screen in WITH_ID) {
    if (!id) return feed();
  } else if (screen === 'settings') {
    // The screen under settings is free text the phone names.
  } else if (screen in PLAIN) {
    if (id) return feed();
  } else {
    return feed();
  }
  const query: [string, string][] = [];
  for (const pair of search ? search.split('&') : []) {
    const [key, value = ''] = splitOnce(pair, '=');
    const name = decode(key);
    const given = decode(value);
    if (name === null || given === null || name === '') return feed();
    query.push([name, given]);
  }
  return { screen, id, query };
}

function splitOnce(text: string, mark: string): [string, string] {
  const at = text.indexOf(mark);
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)];
}

/** A route as a hash, in the order its query was given. */
export function write(route: Route): string {
  const path = `#/${route.screen}${route.id ? `/${encodeURIComponent(route.id)}` : ''}`;
  if (route.query.length === 0) return path;
  const query = route.query
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${path}?${query}`;
}

/** The tab a route sits under, so the rail marks it. */
export function tabOf(route: Route): Tab {
  return WITH_ID[route.screen] ?? PLAIN[route.screen] ?? 'feed';
}

export type Ordering<C extends string> = { column: C; descending: boolean };

/** A table's order as read from a query value `column:asc|desc`; anything else is the fallback. */
export function parseOrder<C extends string>(
  text: string | null,
  columns: readonly C[],
  fallback: Ordering<C>
): Ordering<C> {
  const [column, direction] = (text ?? '').split(':');
  const known = columns.find((candidate) => candidate === column);
  if (known === undefined || (direction !== 'asc' && direction !== 'desc')) return fallback;
  return { column: known, descending: direction === 'desc' };
}

/** A table's order as a query value; null for the default, which is not written. */
export function formatOrder<C extends string>(
  order: Ordering<C>,
  fallback: Ordering<C>
): string | null {
  if (order.column === fallback.column && order.descending === fallback.descending) return null;
  return `${order.column}:${order.descending ? 'desc' : 'asc'}`;
}

/** A route's query value, or null. */
export function queryValue(route: Route, key: string): string | null {
  return route.query.find(([name]) => name === key)?.[1] ?? null;
}

/**
 * The route with each key in `changes` set, or removed when its value is
 * null. A key already in the query keeps its place; a new one goes last. Every
 * page keeps its filter and selection in the hash through this and `go`.
 */
export function withQuery(route: Route, changes: Record<string, string | null>): Route {
  const query: [string, string][] = [];
  for (const [key, value] of route.query) {
    if (!(key in changes)) query.push([key, value]);
    else if (changes[key] !== null) query.push([key, changes[key] as string]);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value !== null && !route.query.some(([name]) => name === key)) query.push([key, value]);
  }
  return { ...route, query };
}

/** Point the address at a route; the hash change redraws. */
export function go(route: Route): void {
  location.hash = write(route);
}

/**
 * What the page shows for a hash. The hash applies only while the link is
 * connected; in any other state the page shows its own pane, and the route
 * last applied is held for when the link is connected again.
 */
export function resolve(
  linkState: string,
  hash: string,
  held: Route | null
): { shown: Route | null; held: Route | null } {
  if (linkState !== 'connected') return { shown: null, held };
  const route = parse(hash);
  return { shown: route, held: route };
}

/** The hash to restore when the link connects: the one held, else the one in the address bar. */
export function restore(held: Route | null, hash: string): string {
  return held ? write(held) : write(parse(hash));
}

export type Press = {
  key: string;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

export type KeyAction =
  | { do: 'tab'; tab: Tab }
  | { do: 'search' }
  | { do: 'closeDetail' }
  | { do: 'help' }
  | { do: 'step'; step: 'next' | 'previous' }
  | { do: 'open' };

/** True when the target takes typed text, so a bare key belongs to it and not to a shortcut. */
export function inField(target: Press['target']): boolean {
  const tag = target?.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
}

/**
 * What a key does. Nothing at all while a text field has focus, or with a
 * modifier held, so the browser's own shortcuts and typing are left alone.
 */
export function keyAction(press: Press): KeyAction | null {
  if (press.ctrlKey || press.metaKey || press.altKey || inField(press.target)) return null;
  const tab = /^[1-5]$/.test(press.key) ? TABS[Number(press.key) - 1] : undefined;
  if (tab) return { do: 'tab', tab };
  if (press.key === '/') return { do: 'search' };
  if (press.key === 'Escape') return { do: 'closeDetail' };
  if (press.key === '?') return { do: 'help' };
  if (press.key === 'j' || press.key === 'ArrowDown') return { do: 'step', step: 'next' };
  if (press.key === 'k' || press.key === 'ArrowUp') return { do: 'step', step: 'previous' };
  if (press.key === 'Enter') return { do: 'open' };
  return null;
}
