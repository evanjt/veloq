import { DEFAULT_PERIOD, type Period } from './period';

/** The origin an insight marks on a section it opens, as the `origin` query value. */
export const INSIGHTS_ORIGIN = 'insights';

const ORIGIN_PARAM = 'origin';

/**
 * A path an insight opens, with the origin marked when it opens a section. A section's page
 * opens on All time from the insights page, so the mark travels on the path. A route already
 * opens on All time, so its path is returned as it is.
 */
export function fromInsightsPath(path: string): string {
  if (!path.startsWith('/section/')) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${ORIGIN_PARAM}=${INSIGHTS_ORIGIN}`;
}

/**
 * The range a section's page opens on: All time when it was opened from the insights page, the
 * window every picker opens on otherwise.
 */
export function sectionOpenRange(origin: string | undefined): Extract<Period, 'all' | '6m'> {
  return origin === INSIGHTS_ORIGIN ? 'all' : DEFAULT_PERIOD;
}
