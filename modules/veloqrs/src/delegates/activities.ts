/**
 * Activity delegates.
 *
 * Wraps activity CRUD, GPS track access, activity metrics, time streams, and
 * debug clone helpers. Most mutations emit notifications on the 'activities',
 * 'groups', and 'sections' channels because adding or removing activities
 * invalidates all three caches downstream.
 */

import type { FfiActivityMetrics, FfiGpsPoint } from '../generated/veloqrs';
import { validateId } from '../conversions';
import type { DelegateHost } from './host';

export async function addActivities(
  host: DelegateHost,
  activityIds: string[],
  allCoords: number[],
  offsets: number[],
  sportTypes: string[]
): Promise<void> {
  if (!host.ready) return;
  host.timed('addActivities', () =>
    host.engine.activities().add(activityIds, allCoords, offsets, sportTypes)
  );
  host.notifyAll('activities', 'groups');
}

export function getActivityIds(host: DelegateHost): string[] {
  if (!host.ready) return [];
  return host.timed('getActivityIds', () => host.engine.activities().getIds());
}

export function getActivityCount(host: DelegateHost): number {
  if (!host.ready) return 0;
  return host.timed('getActivityCount', () => host.engine.activities().getCount());
}

export function cleanupOldActivities(host: DelegateHost, retentionDays: number): number {
  if (!host.ready) return 0;
  const deleted = host.timed('cleanupOldActivities', () =>
    host.engine.cleanupOldActivities(retentionDays)
  );
  if (deleted > 0) {
    host.notifyAll('activities', 'groups', 'sections');
  }
  return deleted;
}

export function getGpsTrack(host: DelegateHost, activityId: string): FfiGpsPoint[] {
  if (!host.ready) return [];
  validateId(activityId, 'activity ID');
  return host.timed('getGpsTrack', () => host.engine.activities().getGpsTrack(activityId));
}

/**
 * Apply activity metrics. If the engine hasn't been initialized yet, the
 * caller stashes these in `pendingMetrics`; that path must stay in the
 * facade since it touches private class state. This delegate only handles
 * the fully-initialized case.
 */
export function setActivityMetricsReady(host: DelegateHost, metrics: FfiActivityMetrics[]): void {
  host.timed('setActivityMetrics', () => host.engine.activities().setMetrics(metrics));
  host.notify('activities');
}

export function setTimeStreams(
  host: DelegateHost,
  streams: Array<{ activityId: string; times: number[] }>
): void {
  if (!host.ready || streams.length === 0) return;

  const activityIds: string[] = [];
  const allTimes: number[] = [];
  const offsets: number[] = [0];

  for (const stream of streams) {
    activityIds.push(stream.activityId);
    allTimes.push(...stream.times);
    offsets.push(allTimes.length);
  }

  host.timed('setTimeStreams', () =>
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

export function getActivityMetricsForIds(host: DelegateHost, ids: string[]): FfiActivityMetrics[] {
  if (!host.ready || ids.length === 0) return [];
  return host.timed('getActivityMetricsForIds', () =>
    host.engine.activities().getMetricsForIds(ids)
  );
}

export function removeActivity(host: DelegateHost, activityId: string): boolean {
  if (!host.ready) return false;
  try {
    host.timed('removeActivity', () => host.engine.activities().remove(activityId));
    host.notifyAll('activities', 'groups', 'sections');
    return true;
  } catch {
    return false;
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
  indicators: any[];
  routeHighlights: any[];
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
