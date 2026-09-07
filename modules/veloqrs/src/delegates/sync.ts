/**
 * Sync service delegates.
 *
 * Thin wrappers over the Rust `SyncManager` FFI object (the single first-class
 * I/O contract). TypeScript sets credentials once, issues commands, reads a
 * status snapshot, and awaits the writes - it never builds an HTTP request or an
 * auth header itself.
 *
 * Reads are fire-and-forget: the command returns instantly and progress surfaces
 * through the status snapshot. Writes are awaited, because whether an upload was
 * accepted decides what happens to the file on the device.
 *
 * The `host.ready` guard only covers reads made before the engine is
 * initialised, returning safe defaults. Writes go through `host.write`, which
 * holds them until it opens. Field casing matches the generated records
 * (camelCase).
 */

import {
  FfiCallKind,
  FfiStartOutcome,
  type FfiCallOutcome,
  type FfiManualActivity,
  type FfiSyncStatus,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';
import { hasStarted } from './start';

/** Auth scheme passed to `setSyncCredentials` (matches Rust `AuthKind::parse`). */
export type SyncAuthMethod = 'oauth' | 'api_key';

/** The generated record. `state` is the `SyncState` enum, not a word. */
export type SyncStatus = FfiSyncStatus;

/** Set the credential once. Never passed per request. */
export function setSyncCredentials(
  host: DelegateHost,
  method: SyncAuthMethod,
  secret: string,
  athleteId: string
): void {
  host.write('setSyncCredentials', () =>
    host.engine.sync().setCredentials(method, secret, athleteId)
  );
}

/** Forget the credential (logout). */
export function clearSyncCredentials(host: DelegateHost): void {
  host.write('clearSyncCredentials', () => host.engine.sync().clearCredentials());
}

/** Start a sync. Returns instantly, naming why when it refuses so a caller can
 *  tell a held slot from a missing credential. Progress surfaces through
 *  `getSyncStatus`. */
export function syncNow(host: DelegateHost): FfiStartOutcome {
  if (!host.ready) return FfiStartOutcome.NotReady;
  const outcome = host.timed('syncNow', () =>
    host.engine.sync().syncNow()
  ) as FfiStartOutcome;
  if (hasStarted(outcome)) host.notify('sync');
  return outcome;
}

/** Fetch and store one date window of activities. Returns instantly, naming why
 *  when it refuses. The feed asks for windows older than the default sync
 *  covers. */
export function syncActivitiesWindow(
  host: DelegateHost,
  oldest: string,
  newest: string
): FfiStartOutcome {
  if (!host.ready) return FfiStartOutcome.NotReady;
  const outcome = host.timed('syncActivitiesWindow', () =>
    host.engine.sync().syncActivitiesWindow(oldest, newest)
  ) as FfiStartOutcome;
  if (hasStarted(outcome)) host.notify('sync');
  return outcome;
}

/** Ask Rust to fetch and store a power curve. Returns false when the same
 *  curve is already in flight or no credentials are set. */
export function syncPowerCurve(host: DelegateHost, sport: string, days: number): boolean {
  if (!host.ready) return false;
  return host.timed('syncPowerCurve', () =>
    host.engine.sync().syncPowerCurve(sport, BigInt(days))
  ) as boolean;
}

/** Ask Rust to fetch and store a pace curve. `gap` is honoured for running only. */
export function syncPaceCurve(
  host: DelegateHost,
  sport: string,
  days: number,
  gap: boolean
): boolean {
  if (!host.ready) return false;
  return host.timed('syncPaceCurve', () =>
    host.engine.sync().syncPaceCurve(sport, BigInt(days), gap)
  ) as boolean;
}

/** Ask Rust to fetch and store an activity's work/recovery intervals. */
export function syncActivityIntervals(host: DelegateHost, activityId: string): boolean {
  if (!host.ready) return false;
  return host.timed('syncActivityIntervals', () =>
    host.engine.sync().syncActivityIntervals(activityId)
  ) as boolean;
}

/** Ask Rust to refresh the calendar events in a date window. */
export function syncCalendarEvents(host: DelegateHost, oldest: string, newest: string): boolean {
  if (!host.ready) return false;
  return host.timed('syncCalendarEvents', () =>
    host.engine.sync().syncCalendarEvents(oldest, newest)
  ) as boolean;
}

/** Ask Rust to fetch and store an activity's streams for a series selection.
 *  The types string is the cache key, so callers must pass it consistently. */
export function syncActivityStreams(
  host: DelegateHost,
  activityId: string,
  types: string
): boolean {
  if (!host.ready) return false;
  return host.timed('syncActivityStreams', () =>
    host.engine.sync().syncActivityStreams(activityId, types)
  ) as boolean;
}

/** Ask Rust to fetch and store an activity's full detail body. */
export function syncActivityDetail(host: DelegateHost, activityId: string): boolean {
  if (!host.ready) return false;
  return host.timed('syncActivityDetail', () =>
    host.engine.sync().syncActivityDetail(activityId)
  ) as boolean;
}

/** Ask Rust to fetch the `time` streams the section maths needs. Activities
 *  that already have one are skipped inside Rust. */
export function syncTimeStreams(host: DelegateHost, activityIds: string[]): boolean {
  if (!host.ready || activityIds.length === 0) return false;
  return host.timed('syncTimeStreams', () =>
    host.engine.sync().syncTimeStreams(activityIds)
  ) as boolean;
}

/**
 * What to report when a write is asked for before the engine exists.
 *
 * `internal` rather than `network`: a cold start is not a connectivity problem,
 * and calling it one would have the upload queue wait for a network change that
 * has already happened.
 */
function engineUnavailable(action: string): FfiCallOutcome {
  return { kind: FfiCallKind.Internal, message: `the engine is not ready to ${action}` };
}

/**
 * Upload a recorded activity file. The FIT streams from `filePath` inside Rust,
 * so the bytes never cross this boundary.
 *
 * Resolves to an outcome rather than rejecting: the caller has to branch on the
 * status to decide whether the recording is retried, parked or blocked on write
 * permission. These write calls skip `host.timed` because it measures the
 * dispatch, not the request the promise is waiting on.
 */
export function uploadActivityFile(
  host: DelegateHost,
  filePath: string,
  filename: string,
  name?: string,
  pairedEventId?: number
): Promise<FfiCallOutcome> {
  if (!host.ready) return Promise.resolve(engineUnavailable('upload'));
  return host.engine
    .sync()
    .uploadActivity(
      filePath,
      filename,
      name,
      pairedEventId === undefined ? undefined : BigInt(pairedEventId)
    );
}

/**
 * Read an uploaded activity back from intervals.icu, to confirm it is there.
 *
 * `Ok` means present, an `Http` outcome carrying 404 means gone, and every
 * other outcome means the question was not answered. Only the first is a
 * confirmation: deleting the device's copy on anything else throws the ride
 * away on a network the caller could simply have asked again.
 */
export function confirmActivityUploaded(
  host: DelegateHost,
  intervalsId: string
): Promise<FfiCallOutcome> {
  if (!host.ready) return Promise.resolve(engineUnavailable('confirm the upload'));
  return host.engine.sync().confirmActivityUploaded(intervalsId);
}

/** Create an activity with no file behind it, for indoor entries. */
export function createManualActivity(
  host: DelegateHost,
  activity: FfiManualActivity
): Promise<FfiCallOutcome> {
  if (!host.ready) return Promise.resolve(engineUnavailable('create an activity'));
  return host.engine.sync().createManualActivity(activity);
}

/**
 * Check a credential and report the athlete it belongs to, without storing it.
 * Login confirms a key this way before it is committed anywhere.
 */
export function validateSyncCredentials(
  host: DelegateHost,
  method: SyncAuthMethod,
  secret: string
): Promise<FfiCallOutcome> {
  if (!host.ready) return Promise.resolve(engineUnavailable('check the credential'));
  return host.engine.sync().validateCredentials(method, secret);
}

/**
 * Soft-cancel the running sync.
 *
 * Guarded, not written: a cancel held from before the engine opened refers to
 * a sync that never started, and replaying it would cancel the launch sync the
 * athlete did start.
 */
export function cancelSync(host: DelegateHost): void {
  if (!host.ready) return;
  host.timed('cancelSync', () => host.engine.sync().cancel());
  host.notify('sync');
}

/**
 * How many on-demand bodies Rust has stored this session.
 *
 * An on-demand fetch settles on a Rust thread, which cannot reach the
 * TypeScript listener map, so a reader waiting on a body watches this count and
 * fans a change out over the engine channel when it moves. Zero before the
 * engine is ready, which reads as "nothing has landed yet".
 */
export function getBodiesStored(host: DelegateHost): number {
  if (!host.ready) return 0;
  return Number(host.timed('getBodiesStored', () => host.engine.sync().bodiesStored()));
}

/** Current status snapshot (null before the engine is ready). */
export function getSyncStatus(host: DelegateHost): SyncStatus | null {
  if (!host.ready) return null;
  return (host.timed('getSyncStatus', () => host.engine.sync().getSyncStatus()) ??
    null) as SyncStatus | null;
}
