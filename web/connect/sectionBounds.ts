// What the section page and the activity page do with a pair of ends dragged
// along a track: the vertex an end snaps to, the padded window around a section, and the writes a save and its
// undo send. The engine measures and stores the section; this only places the ends
// and asks. Pure, so a test drives it without a browser.

import { haversineDistance } from '@/shared/geo/distance';
import { nearestIndex, type LngLat } from './map/activityLayers';
import type { LatLng } from './fit';
import type { QueryClient } from './query';
import type { Methods } from './schema';

/** The fewest points a section keeps; the engine refuses a bounds edit below it. */
export const MIN_POINTS = 5;

/** The first and last vertex kept, both inclusive. */
export type Span = { start: number; end: number };

export type Handle = 'start' | 'end';

/** Track vertices as the map takes them, from the `[lat, lng]` pairs the engine's lines decode to. */
export const lngLatOf = (points: readonly LatLng[]): LngLat[] =>
  points.map(([lat, lng]) => [lng, lat]);

/** Metres between two positions, along the great circle. */
export function metresBetween(a: LngLat, b: LngLat): number {
  return haversineDistance(a[1], a[0], b[1], b[0]);
}

/** Metres along `path` from vertex `span.start` to vertex `span.end`. */
export function pathMetres(path: readonly LngLat[], span: Span): number {
  let metres = 0;
  for (let at = Math.max(0, span.start); at < Math.min(span.end, path.length - 1); at += 1) {
    metres += metresBetween(path[at] as LngLat, path[at + 1] as LngLat);
  }
  return metres;
}

/** The vertex of `path` nearest `at`, looking only inside `within`; null when none lies there. */
export function snapIndex(
  path: readonly (LngLat | null)[],
  at: LngLat,
  within: Span
): number | null {
  const from = Math.max(0, within.start);
  const to = Math.min(path.length - 1, within.end);
  if (from > to) return null;
  const found = nearestIndex(path.slice(from, to + 1), at);
  return found === null ? null : found + from;
}

/**
 * `span` with one end put on vertex `to`, held inside `limits` and at least `MIN_POINTS`
 * vertices from the other end. An end that cannot move that far stays where it is.
 */
export function moved(span: Span, handle: Handle, to: number, limits: Span): Span {
  if (handle === 'start') {
    const latest = span.end - (MIN_POINTS - 1);
    if (latest < limits.start) return span;
    return { start: Math.min(Math.max(to, limits.start), latest), end: span.end };
  }
  const earliest = span.start + (MIN_POINTS - 1);
  if (earliest > limits.end) return span;
  return { start: span.start, end: Math.max(Math.min(to, limits.end), earliest) };
}

/** Whether the span keeps enough vertices to save. */
export const keepsEnough = (span: Span): boolean => span.end - span.start + 1 >= MIN_POINTS;

/**
 * The part of a whole track shown around a section: the section's own range and a margin on
 * each side of the larger of 500 m and half the section, up to 2 km.
 */
export function paddedWindow(path: readonly LngLat[], section: Span): Span {
  const margin = Math.min(Math.max(500, pathMetres(path, section) * 0.5), 2000);
  let start = section.start;
  let walked = 0;
  while (start > 0 && walked < margin) {
    walked += metresBetween(path[start] as LngLat, path[start - 1] as LngLat);
    start -= 1;
  }
  let end = section.end;
  walked = 0;
  while (end < path.length - 1 && walked < margin) {
    walked += metresBetween(path[end] as LngLat, path[end + 1] as LngLat);
    end += 1;
  }
  return { start, end };
}

type EditAsk = Methods['section.editBounds']['params'];
type EditWrite = { method: 'section.editBounds'; params: EditAsk };

const ask = (id: string, edit: EditAsk['edit'], rest: Partial<EditAsk> = {}): EditWrite => ({
  method: 'section.editBounds',
  params: {
    id,
    edit,
    activityId: null,
    startIndex: null,
    endIndex: null,
    version: null,
    ...rest,
  },
});

/** Cut the section's own line to `span`. */
export const trimWrite = (id: string, span: Span): EditWrite =>
  ask(id, 'trim', { startIndex: span.start, endIndex: span.end });

/** Take `span` of the activity's track as the section's line, which grows it or shrinks it. */
export const expandWrite = (id: string, activityId: string, span: Span): EditWrite =>
  ask(id, 'expand', { activityId, startIndex: span.start, endIndex: span.end });

/** Put the line the section had before its first edit back. */
export const resetWrite = (id: string): EditWrite => ask(id, 'reset');

/** Draw the section along `activityId`'s track. */
export const setReferenceWrite = (id: string, activityId: string): EditWrite =>
  ask(id, 'setReference', { activityId });

/** Hand the reference back to the detector. */
export const resetReferenceWrite = (id: string): EditWrite => ask(id, 'resetReference');

/** Put a stored geometry version back as the line. */
export const revertWrite = (id: string, version: number): EditWrite =>
  ask(id, 'revert', { version });

type History = Methods['section.history']['result'];

/**
 * The version that holds the line a section had before an edit: the pinned one, else the
 * newest, and the first when none was stored, which the first edit stores for the line it
 * replaces. Read from the ledger before the edit is sent.
 */
export function liveVersionOf(
  history: Pick<History, 'geometryVersions' | 'pinnedVersion'>
): number {
  if (history.pinnedVersion !== null) return history.pinnedVersion;
  const stored = history.geometryVersions.map((entry) => entry.version);
  return stored.length === 0 ? 1 : Math.max(...stored);
}

/** The ask that cuts a section from stored activity's track, `span` inclusive. */
export function createAsk(
  activityId: string,
  span: Span,
  sport: string,
  name: string
): Methods['section.create']['params'] {
  return {
    activityId,
    startIndex: span.start,
    endIndex: span.end,
    sport,
    name: name.trim() === '' ? null : name.trim(),
  };
}

/**
 * The vertex of a distance series nearest `metres`, so a distance typed into a field puts an
 * end on a sample; null for an empty series.
 */
export function indexAtDistance(distance: readonly number[], metres: number): number | null {
  if (distance.length === 0) return null;
  let best = 0;
  let gap = Infinity;
  distance.forEach((value, at) => {
    const away = Math.abs(value - metres);
    if (away < gap) {
      gap = away;
      best = at;
    }
  });
  return best;
}

/**
 * The write that puts back the line the section holds now, read from its ledger before an edit
 * is sent; none when the ledger cannot be read, and the edit goes without an undo.
 */
export async function undoOfEdit(phone: QueryClient, id: string): Promise<EditWrite[]> {
  try {
    const history = (await phone.fetch('section.history', { id })) as History;
    return [revertWrite(id, liveVersionOf(history))];
  } catch {
    return [];
  }
}

/** The writes that flag a section as lifting ground or clear it, and the ones that take that back. */
export function liftWrites(id: string, isLift: boolean) {
  const set = (flag: boolean) => [
    { method: 'section.setLift' as const, params: { id, isLift: flag } },
  ];
  return { writes: set(isLift), undo: set(!isLift) };
}

/**
 * What takes a merge back: the merged section restored, then the kept section put back on the
 * line it had before, read from its ledger before the merge (none when it could not be read).
 */
export function mergeUndoWrites(
  mergedId: string,
  keptRevert: readonly EditWrite[]
): { method: keyof Methods; params: object }[] {
  return [{ method: 'section.restore', params: { id: mergedId } }, ...keptRevert];
}

/** What Escape does to a bounds draft: close one that changed nothing, ask about one that did. */
export const escapeAction = (dirty: boolean): 'close' | 'confirm' => (dirty ? 'confirm' : 'close');

/**
 * The distance and grade the editor shows: the engine's stored figures while the ends sit where
 * the section has them, so they agree with the header, and the engine's preview of the moved
 * ends once there is one. Moved ends the engine has not measured show no figure.
 */
export function shownBounds(
  unchanged: boolean,
  stored: { distanceMeters: number; avgGradePercent: number | null },
  preview: Methods['section.boundsPreview']['result'] | null
): { metres: number | null; slope: number | null } {
  if (unchanged) return { metres: stored.distanceMeters, slope: stored.avgGradePercent };
  return preview
    ? { metres: preview.distanceMeters, slope: preview.avgGradePercent }
    : { metres: null, slope: null };
}
