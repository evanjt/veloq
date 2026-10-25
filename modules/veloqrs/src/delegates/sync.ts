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
  FfiStartOutcome,
  FfiSwapOutcome,
  FfiSwapState,
  GarminKeyStatus,
  type GarminAccount,
  type FfiStartResult,
  type FfiSwapResult,
  RangeCoverage,
  type LibraryCoverage,
  type FfiSyncStatus,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';
import { hasStarted, startResult } from './start';

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

/** Ask Garmin whether a pasted Personal key works, holding it in the engine
 *  for this process only when it does. Unreachable before the engine opens:
 *  nothing is known about the key then. */
export async function connectGarmin(host: DelegateHost, key: string): Promise<GarminKeyStatus> {
  if (!host.ready) return GarminKeyStatus.Unreachable;
  return host.timedAsync('connectGarmin', () => host.engine.sync().connectGarmin(key));
}

/** The account behind the key held in the engine, read after a connect. Unreachable before the engine opens: no key is held then. */
export async function garminAccount(host: DelegateHost): Promise<GarminAccount | undefined> {
  if (!host.ready) return undefined;
  return host.timedAsync('garminAccount', () => host.engine.sync().garminAccount());
}

/** Hand the engine the key the keychain gave back, unchecked. */
export function holdGarminKey(host: DelegateHost, key: string): void {
  host.write('holdGarminKey', () => host.engine.sync().holdGarminKey(key));
}

/** Forget the Garmin key in the engine. Nothing fetched with it is removed. */
export function clearGarminKey(host: DelegateHost): void {
  host.write('clearGarminKey', () => host.engine.sync().clearGarminKey());
}

/** Pull Garmin's rides now: a paused pass goes on at once and a stopped one
 *  starts. False when the engine is not open or no pass is running after. It
 *  refers to the athlete's tap, so it is not held and replayed at open. */
export function pullGarminNow(host: DelegateHost): boolean {
  if (!host.ready) return false;
  return host.timed('pullGarminNow', () => host.engine.sync().pullGarminNow());
}

/** A webhook named this activity: the engine starts a Garmin pass when
 *  intervals.icu says Garmin supplied it. */
export function pullGarminForActivity(host: DelegateHost, activityId: string): boolean {
  if (!host.ready) return false;
  return host.timed('pullGarminForActivity', () =>
    host.engine.sync().pullGarminForActivity(activityId)
  );
}

/** Whether the activity offers Garmin's own file, an undo of an earlier swap,
 *  or nothing. The engine compares the two files, so it is nothing before the
 *  engine opens. */
export async function garminSwapState(
  host: DelegateHost,
  activityId: string
): Promise<FfiSwapState> {
  if (!host.ready) return FfiSwapState.Hidden;
  return host.timedAsync('garminSwapState', () => host.engine.sync().garminSwapState(activityId));
}

/** Replace intervals.icu's file for the activity with Garmin's original. */
export async function garminSwapReplace(
  host: DelegateHost,
  activityId: string
): Promise<FfiSwapResult> {
  if (!host.ready) return { outcome: FfiSwapOutcome.Failed };
  return host.timedAsync('garminSwapReplace', () =>
    host.engine.sync().garminSwapReplace(activityId)
  );
}

/** Put the file intervals.icu held before the swap back. */
export async function garminSwapUndo(
  host: DelegateHost,
  activityId: string
): Promise<FfiSwapResult> {
  if (!host.ready) return { outcome: FfiSwapOutcome.Failed };
  return host.timedAsync('garminSwapUndo', () => host.engine.sync().garminSwapUndo(activityId));
}

/** Start a sync. Returns instantly, naming why when it refuses so a caller can
 *  tell a held slot from a missing credential. Progress surfaces through
 *  `getSyncStatus`. `force` fetches the athlete profile whatever its age;
 *  without it the engine asks for the profile at most once in six hours.
 *  Inside a refusal's cooldown it answers held with the time the cooldown
 *  ends, sends nothing, and the engine starts the sync itself then. */
export function syncNow(host: DelegateHost, force: boolean): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  const result = host.timed('syncNow', () => host.engine.sync().syncNow(force)) as FfiStartResult;
  if (hasStarted(result)) host.notify('sync');
  return result;
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

/** What a date range holds: nothing, a download still owed, or every activity
 *  in it local and current. A chart drawing an empty axis cannot say why on its
 *  own, and "no data" was the answer for both of the first two.
 *
 *  An engine that is not open yet answers `NotFetched`: nothing is known about
 *  the range either way, and `Empty` would be a claim. */
export function rangeCoverage(host: DelegateHost, oldest: string, newest: string): RangeCoverage {
  if (!host.ready) return RangeCoverage.NotFetched;
  return host.timed('rangeCoverage', () =>
    host.engine.sync().rangeCoverage(oldest, newest)
  ) as RangeCoverage;
}

/** How much of the signed-in athlete's library is on the device: the activity
 *  pages and the GPS tracks, each as stored against upstream. Every other
 *  progress figure is the running pass's own queue, which says nothing about
 *  the rides no pass has queued.
 *
 *  An engine that is not open yet answers zeros, which every surface reads as
 *  nothing to report. */
export function libraryCoverage(host: DelegateHost): LibraryCoverage {
  if (!host.ready) return NOTHING_KNOWN;
  return host.timed('libraryCoverage', () =>
    host.engine.sync().libraryCoverage()
  ) as LibraryCoverage;
}

const NOTHING_KNOWN: LibraryCoverage = {
  upstream: 0,
  fetched: 0,
  tracksUpstream: 0,
  tracksStored: 0,
};

/** Ask Rust to fetch and store a power curve. The verdict says whether waiting
 *  helps: `Busy` is the same curve already in flight, `NotConfigured` is no
 *  credential and never becomes one by asking again. */
export function syncPowerCurve(host: DelegateHost, sport: string, days: number): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  return host.timed('syncPowerCurve', () => host.engine.sync().syncPowerCurve(sport, days));
}

/** Ask Rust to fetch and store a pace curve. `gap` is honoured for running only. */
export function syncPaceCurve(
  host: DelegateHost,
  sport: string,
  days: number,
  gap: boolean
): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  return host.timed('syncPaceCurve', () => host.engine.sync().syncPaceCurve(sport, days, gap));
}

/** Ask Rust to fetch and store an activity's work/recovery intervals. */
export function syncActivityIntervals(host: DelegateHost, activityId: string): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  return host.timed('syncActivityIntervals', () =>
    host.engine.sync().syncActivityIntervals(activityId)
  );
}

/** Ask Rust to refresh the calendar events in a date window. */
export function syncCalendarEvents(
  host: DelegateHost,
  oldest: string,
  newest: string
): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  return host.timed('syncCalendarEvents', () =>
    host.engine.sync().syncCalendarEvents(oldest, newest)
  );
}

/** Ask Rust to fetch and store an activity's streams for a series selection.
 *  The types string is the cache key, so callers must pass it consistently. */
export function syncActivityStreams(
  host: DelegateHost,
  activityId: string,
  types: string
): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  return host.timed('syncActivityStreams', () =>
    host.engine.sync().syncActivityStreams(activityId, types)
  );
}

/** Ask Rust to fetch and store an activity's full detail body. */
export function syncActivityDetail(host: DelegateHost, activityId: string): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  return host.timed('syncActivityDetail', () => host.engine.sync().syncActivityDetail(activityId));
}

/** Ask Rust to fetch what one activity still lacks for a screen that opens
 *  with no network, resolving with whether it lacks nothing afterwards. */
export async function readyActivityBodies(
  host: DelegateHost,
  activityId: string
): Promise<boolean> {
  if (!host.ready) return false;
  return host.timedAsync('readyActivityBodies', () =>
    host.engine.sync().readyActivityBodies(activityId)
  );
}

/** Ask Rust to fetch the `time` streams the section maths needs. Activities
 *  that already have one are skipped inside Rust. */
export function syncTimeStreams(host: DelegateHost, activityIds: string[]): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  // Nothing asked for is no work, not a refusal to do it.
  if (activityIds.length === 0) return startResult(FfiStartOutcome.NotOwed);
  return host.timed('syncTimeStreams', () => host.engine.sync().syncTimeStreams(activityIds));
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
  return host.timed('getBodiesStored', () => host.engine.sync().bodiesStored());
}

/** Current status snapshot (null before the engine is ready). */
export function getSyncStatus(host: DelegateHost): SyncStatus | null {
  if (!host.ready) return null;
  return (host.timed('getSyncStatus', () => host.engine.sync().getSyncStatus()) ??
    null) as SyncStatus | null;
}
