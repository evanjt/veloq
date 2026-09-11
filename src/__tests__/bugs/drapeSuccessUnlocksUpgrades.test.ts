/**
 * Scenario: twenty cards fell back to a flat stand-in last night. Today one
 * other card renders its drape, which is proof the tile host is answering.
 *
 * Expected behaviour: that proof is what re-queues the twenty. Nothing may
 * probe the host to find out, because a throttled host is the likely reason
 * they fell back at all, so a render that just succeeded is the only free
 * signal there is. A flat render is no evidence about terrain and unlocks
 * nothing.
 */

import { upgradesUnlockedBy } from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const request = (
  activityId: string,
  mapStyle: 'light' | 'satellite' = 'light',
  extra: Partial<SnapshotRequest> = {}
): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: 60, bearing: 0 },
  mapStyle,
  routeColor: '#ff0000',
  flat: false,
  ...extra,
});

const downgraded = (...requests: SnapshotRequest[]) =>
  new Map(requests.map((r) => [`${r.activityId}_${r.mapStyle}_d`, r]));

describe('a successful drape is what unlocks the cards that fell back', () => {
  it('re-queues every downgraded card of the same style, marked as an upgrade', () => {
    const waiting = downgraded(request('a1'), request('a2'));

    const unlocked = upgradesUnlockedBy(waiting, request('a3'));

    expect(unlocked.map((r) => r.activityId).sort()).toEqual(['a1', 'a2']);
    expect(unlocked.every((r) => r.upgrade === true)).toBe(true);
    expect(unlocked.every((r) => r.flat === false)).toBe(true);
  });

  it('leaves the other style alone', () => {
    const waiting = downgraded(request('a1', 'light'), request('a2', 'satellite'));

    const unlocked = upgradesUnlockedBy(waiting, request('a3', 'satellite'));

    expect(unlocked.map((r) => r.activityId)).toEqual(['a2']);
  });

  it('is no evidence when the render that succeeded was flat', () => {
    const waiting = downgraded(request('a1'));

    expect(upgradesUnlockedBy(waiting, request('a3', 'light', { flat: true }))).toEqual([]);
  });

  it('is no evidence when the render that succeeded was itself a stand-in', () => {
    const waiting = downgraded(request('a1'));

    expect(
      upgradesUnlockedBy(waiting, request('a3', 'light', { flat: true, standIn: true }))
    ).toEqual([]);
  });

  it('starts each re-queued card at the top of the retry ladder', () => {
    const waiting = downgraded(request('a1', 'light', { _retryAttempt: 1 }));

    expect(upgradesUnlockedBy(waiting, request('a3'))[0]._retryAttempt).toBe(0);
  });

  it('unlocks nothing when nothing is waiting', () => {
    expect(upgradesUnlockedBy(new Map(), request('a3'))).toEqual([]);
  });
});
