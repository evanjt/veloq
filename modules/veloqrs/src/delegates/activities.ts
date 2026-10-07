/**
 * Activity delegates.
 *
 * Wraps activity CRUD, GPS track access, activity metrics, time streams, and
 * debug clone helpers. Most mutations emit notifications on the 'activities',
 * 'groups', and 'sections' channels because adding or removing activities
 * invalidates all three caches downstream.
 */

import type {
  FfiActivityBody,
  FfiActivityDetailData,
  FfiActivityIndicator,
  FfiActivityMetrics,
  FfiActivityNotification,
  FfiActivityRouteHighlight,
  FfiActivityBodiesPage,
  FfiActivityBodiesQuery,
  FfiPreviewTrack,
} from '../generated/veloqrs';
import { validateId } from '../conversions';
import type { DelegateHost } from './host';

export async function addActivities(
  host: DelegateHost,
  activityIds: string[],
  allCoords: number[],
  offsets: number[],
  sportTypes: string[]
): Promise<void> {
  host.write('addActivities', () => {
    host.engine.activities().add(activityIds, allCoords, offsets, sportTypes);
    host.notifyAll('activities', 'groups');
  });
}

/**
 * Store the track, feed body and metrics together, or leave none of them. The
 * track is read from the FIT at `fitPath` inside Rust, so no position crosses
 * this boundary. A manual entry passes no path and gets a row with no track.
 */
export async function saveProvisionalActivity(
  host: DelegateHost,
  activityId: string,
  fitPath: string | undefined,
  body: FfiActivityBody
): Promise<boolean> {
  if (!host.ready) return false;
  validateId(activityId, 'activity ID');
  await host.timed('saveProvisionalActivity', () =>
    host.engine.activities().saveProvisional(activityId, fitPath, body)
  );
  host.notifyAll('activities', 'groups');
  return true;
}

/** A recording always returns to the same local activity on a save retry. */
export function provisionalActivityId(host: DelegateHost, recordingId: string): string {
  if (!host.ready) return '';
  validateId(recordingId, 'recording ID');
  return host.timed('provisionalActivityId', () =>
    host.engine.activities().provisionalId(recordingId)
  );
}

/** Record the id intervals.icu gave a locally keyed ride. */
export function recordActivityUpload(
  host: DelegateHost,
  activityId: string,
  intervalsId: string
): boolean {
  if (!host.ready) return false;
  validateId(activityId, 'activity ID');
  return host.timed('recordActivityUpload', () =>
    host.engine.activities().recordUpload(activityId, intervalsId)
  );
}

export function getActivityIds(host: DelegateHost): string[] {
  if (!host.ready) return [];
  return host.timed('getActivityIds', () => host.engine.activities().getIds());
}

/** The activities whose track the engine refused for good, so none is requested again. */
export function getRefusedTrackIds(host: DelegateHost): string[] {
  if (!host.ready) return [];
  return host.timed('getRefusedTrackIds', () => host.engine.activities().getRefusedTrackIds());
}

/**
 * Whether the library already holds this activity.
 *
 * One boolean, answered from the engine's in-memory metadata. Asking
 * `getActivityIds().includes(id)` lifted every id string across the bridge to
 * decide the same thing.
 */
export function hasActivity(host: DelegateHost, activityId: string): boolean {
  if (!host.ready) return false;
  validateId(activityId, 'activity ID');
  return host.timed('hasActivity', () => host.engine.activities().has(activityId));
}

export function getActivityCount(host: DelegateHost): number {
  if (!host.ready) return 0;
  return host.timed('getActivityCount', () => host.engine.activities().getCount());
}

/**
 * The stored track, coordinate-encoded. Put it through `decodeCoords`.
 *
 * An empty buffer is both "no such activity" and "a track with no points", the
 * same as the section line and the representative route, and the decoder answers `[]`
 * to either.
 */
export function getGpsTrack(host: DelegateHost, activityId: string): ArrayBuffer {
  if (!host.ready) return new Uint8Array().buffer;
  validateId(activityId, 'activity ID');
  return host.timed('getGpsTrack', () => host.engine.activities().getGpsTrack(activityId));
}

/**
 * One feed card's preview line, coordinate-encoded. Put it through
 * `decodeCoords`. Undefined when the activity has no signature to draw.
 */
export function getPreviewTrack(
  host: DelegateHost,
  activityId: string
): FfiPreviewTrack | undefined {
  if (!host.ready) return undefined;
  validateId(activityId, 'activity ID');
  return host.timed('getPreviewTrack', () => host.engine.activities().getPreviewTrack(activityId));
}

/** Store a batch of computed metrics. Held until the engine opens. */
export function setActivityMetrics(host: DelegateHost, metrics: FfiActivityMetrics[]): void {
  if (metrics.length === 0) return;
  host.write('setActivityMetrics', () => {
    host.engine.activities().setMetrics(metrics);
    host.notify('activities');
  });
}

export function setTimeStreams(
  host: DelegateHost,
  streams: { activityId: string; times: number[] }[]
): void {
  if (streams.length === 0) return;

  const activityIds: string[] = [];
  const allTimes: number[] = [];
  const offsets: number[] = [0];

  for (const stream of streams) {
    activityIds.push(stream.activityId);
    allTimes.push(...stream.times);
    offsets.push(allTimes.length);
  }

  host.write('setTimeStreams', () =>
    host.engine.activities().setTimeStreams(activityIds, allTimes, offsets)
  );
}

export function getActivitiesMissingTimeStreams(
  host: DelegateHost,
  activityIds: string[]
): string[] {
  if (!host.ready || activityIds.length === 0) return [];
  return host.timed('getActivitiesMissingTimeStreams', () =>
    host.engine.activities().getMissingTimeStreams(activityIds)
  );
}

/// A refusal carries the sections that hold the activity as their geometry
/// reference, so the caller can name them.
export type RemoveActivityResult = { ok: true } | { ok: false; reason: string };

export function removeActivity(host: DelegateHost, activityId: string): RemoveActivityResult {
  if (!host.ready) return { ok: false, reason: 'engine not ready' };
  try {
    host.timed('removeActivity', () => host.engine.activities().remove(activityId));
    host.notifyAll('activities', 'groups', 'sections');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export function debugCloneActivity(host: DelegateHost, sourceId: string, count: number): number {
  if (!host.ready) return 0;
  const created = host.timed('debugCloneActivity', () =>
    host.engine.activities().debugClone(sourceId, count)
  );
  if (created > 0) {
    host.notifyAll('activities', 'groups', 'sections');
  }
  return created;
}

export interface ActivityHighlightsBundle {
  indicators: FfiActivityIndicator[];
  routeHighlights: FfiActivityRouteHighlight[];
}

/**
 * Single-call bundle of section indicators + route highlights for a batch
 * of activity IDs. Replaces the two-FFI sequence in
 * `useActivitySectionHighlights`.
 */
export function getActivityHighlightsBundle(
  host: DelegateHost,
  activityIds: string[]
): ActivityHighlightsBundle {
  if (!host.ready || activityIds.length === 0) {
    return { indicators: [], routeHighlights: [] };
  }
  return host.timed('getActivityHighlightsBundle', () =>
    host.engine.activities().getHighlightsBundle(activityIds)
  );
}

/**
 * Every read the activity detail screen paints with, in one round-trip:
 * engine counts, route groups, matched and custom sections, encounters,
 * indicator highlights, per-section traces and the sections this activity
 * holds the record on.
 */
export function getActivityDetailData(
  host: DelegateHost,
  activityId: string,
  minRouteActivities: number
): FfiActivityDetailData | undefined {
  if (!host.ready || !activityId) return undefined;
  return host.timed('getActivityDetailData', () =>
    host.engine.activities().getDetailData(activityId, minRouteActivities)
  );
}

export interface ActivityBodyInput {
  activityId: string;
  /** Start time as epoch seconds. */
  date: number;
  /** The untyped intervals.icu activity payload. */
  raw: string;
}

/**
 * Store untyped activity bodies. Demo seeding writes the same table a live
 * sync fills, so every downstream read is identical in both modes.
 */
export function upsertActivityBodies(host: DelegateHost, rows: ActivityBodyInput[]): void {
  if (rows.length === 0) return;
  host.write('upsertActivityBodies', () =>
    host.engine.activities().upsertActivityBodies(
      rows.map((r) => ({
        activityId: r.activityId,
        date: r.date,
        raw: r.raw,
      }))
    )
  );
}

/**
 * One activity's untyped body, or null when the engine has not got it.
 *
 * `activity_bodies` is keyed by the id, so this is a primary-key lookup. A
 * caller after one activity uses this rather than `getActivityBodies`, which
 * hands back a whole window for JavaScript to parse.
 */
export function getActivityBody(host: DelegateHost, activityId: string): string | null {
  if (!host.ready) return null;
  validateId(activityId, 'activity ID');
  return host.timed(
    'getActivityBody',
    () => host.engine.activities().getActivityBody(activityId) ?? null
  );
}

/**
 * Untyped activity bodies over an inclusive timestamp window, newest first.
 *
 * The feed and detail screens read fields no Rust type models (calories,
 * weather, stream_types), so they parse these rather than a
 * reconstruction from `activity_metrics`.
 */
export function getActivityBodies(
  host: DelegateHost,
  oldestTs: number,
  newestTs: number
): string[] {
  if (!host.ready) return [];
  return (
    readActivityBodies(host, 'getActivityBodies', {
      oldestTs,
      newestTs,
      needle: '',
      sportGroups: [],
      offset: 0,
    })?.bodies ?? []
  );
}

/** A feed search: the text and the chip, paged, over every stored activity. */
export type ActivityBodiesSearch = Pick<
  FfiActivityBodiesQuery,
  'needle' | 'sportGroups' | 'offset' | 'limit' | 'oldestTs' | 'newestTs'
>;

/**
 * The feed's search and sport chips over every stored activity, newest first,
 * with the count of everything matched. The same engine read as the windowed
 * feed with no window, so a search reaches activities no loaded window holds.
 * Undefined when the engine is not ready.
 */
export function searchActivityBodies(
  host: DelegateHost,
  query: ActivityBodiesSearch
): FfiActivityBodiesPage | undefined {
  if (!host.ready) return undefined;
  return readActivityBodies(host, 'searchActivityBodies', query);
}

function readActivityBodies(
  host: DelegateHost,
  label: string,
  query: FfiActivityBodiesQuery
): FfiActivityBodiesPage | undefined {
  return host.timed(label, () => host.engine.activities().getActivityBodies(query));
}

/** One activity's display name, as the engine knows it. */
export interface ActivityName {
  activityId: string;
  name: string;
  /** Start time as epoch seconds. */
  date: number;
}

/**
 * Display names for a batch of activity ids, in the order asked for.
 *
 * Ids the engine has no name for are absent rather than carrying an empty
 * string, so a caller can tell "no name" from "a blank name" and fall back to
 * the id. Batched because the callers draw a row at a time and a call per id
 * is a blocking FFI hop each.
 */
export function getActivityNames(host: DelegateHost, activityIds: string[]): ActivityName[] {
  if (!host.ready || activityIds.length === 0) return [];
  return (
    host
      .timed('getActivityNames', () => host.engine.activities().getActivityNames(activityIds))
      ?.map((row) => ({
        activityId: row.activityId,
        name: row.name,
        date: Number(row.date),
      })) ?? []
  );
}

/**
 * A stored stream payload for an activity and series selection, or null when
 * it has not been fetched or has aged out of the bounded cache.
 */
export function getStreamBody(
  host: DelegateHost,
  activityId: string,
  types: string
): string | null {
  if (!host.ready) return null;
  return (
    (host.timed('getStreamBody', () =>
      host.engine.activities().getStreamBody(activityId, types)
    ) as string | undefined) ?? null
  );
}

export interface CalendarEventBodyInput {
  eventId: string;
  /** Event day as epoch seconds. */
  date: number;
  raw: string;
}

/** Store an activity's interval payload directly, for demo seeding. */
export function setIntervalBody(host: DelegateHost, activityId: string, raw: string): void {
  host.write('setIntervalBody', () => host.engine.activities().setIntervalBody(activityId, raw));
}

/** Store a curve payload directly, for demo seeding. */
export function setCurveBody(
  host: DelegateHost,
  kind: 'power' | 'pace',
  sport: string,
  days: number,
  gap: boolean,
  raw: string
): void {
  host.write('setCurveBody', () =>
    host.engine.activities().setCurveBody(kind, sport, days, gap, raw)
  );
}

/** Replace the calendar events in a window, for demo seeding. */
export function replaceCalendarEvents(
  host: DelegateHost,
  oldestTs: number,
  newestTs: number,
  rows: CalendarEventBodyInput[]
): void {
  const events = rows.map((r) => ({ eventId: r.eventId, date: r.date, raw: r.raw }));
  host.write('replaceCalendarEvents', () =>
    host.engine.activities().replaceCalendarEvents(oldestTs, newestTs, events)
  );
}

/**
 * What one activity was worth: the title and body a lock screen shows, and the
 * same finding whole for a screen.
 *
 * Null before the engine opens, and on an install where no templates have
 * been pushed yet, which is a body of raw keys avoided rather than a failure.
 */
export function activityNotification(
  host: DelegateHost,
  activityId: string,
  activityName: string,
  announcePrs: boolean,
  announceMilestones: boolean
): FfiActivityNotification | null {
  if (!host.ready) return null;
  validateId(activityId, 'activity ID');
  return (
    host.timed('activityNotification', () =>
      host.engine
        .activities()
        .activityNotification(activityId, activityName, announcePrs, announceMilestones)
    ) ?? null
  );
}
