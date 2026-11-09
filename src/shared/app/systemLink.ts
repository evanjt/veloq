/**
 * How a link from outside the app is read. The router's check and the
 * recording arm both read a link through this module, so a shape the router
 * opens is the same shape the arm marks.
 */

/** The scheme, and an Expo Go launch prefix (`host/--/`), at the start of a link. */
const LINK_PREFIX = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/]*\/--\/)?/i;

/**
 * The screen a recording link names, with the identifier it carries. The
 * review is reached only from inside the app, so a link to it opens nothing.
 */
export const RECORDING_ENTRY_SCREEN = /^recording\/(?!review$)[^/]+$/;

export interface SystemLink {
  /** The text before the route: the scheme, any Expo Go prefix and the slashes that follow them. */
  head: string;
  /** The route after the head, with its query and fragment. */
  route: string;
  /** The route without its query, its fragment or its trailing slashes. */
  screen: string;
  /** The query string, without the `?`. */
  query: string;
  /** The fragment, including the `#`, or empty. */
  hash: string;
}

/** Splits a link into its head, its route and the screen the route names. */
export function parseSystemLink(path: string): SystemLink {
  const prefix = LINK_PREFIX.exec(path)?.[0] ?? '';
  const slashes = /^\/*/.exec(path.slice(prefix.length))?.[0] ?? '';
  const head = prefix + slashes;
  const route = path.slice(head.length);
  const hashAt = route.indexOf('#');
  const beforeHash = hashAt === -1 ? route : route.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const pathOnly = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  return {
    head,
    route,
    screen: pathOnly.replace(/\/+$/, ''),
    query: queryAt === -1 ? '' : beforeHash.slice(queryAt + 1),
    hash: hashAt === -1 ? '' : route.slice(hashAt),
  };
}
