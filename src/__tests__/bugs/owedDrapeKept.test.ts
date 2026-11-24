/**
 * Scenario: a card holds a flat stand-in and is owed a drape, while the pool's
 * queue is full or the card has spent its attempts.
 *
 * Expected behaviour: a refused upgrade costs no attempt and stays owed, and a
 * pull-to-refresh asks for every owed drape again alongside the failed renders.
 */

import {
  admitToQueue,
  allowUpgradeAttempt,
  MAX_UPGRADE_ATTEMPTS,
  recordOwedDrape,
  requestKey,
  retryRequests,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const request = (overrides: Partial<SnapshotRequest> = {}): SnapshotRequest => ({
  activityId: 'a1',
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: 60, bearing: 0 } as never,
  mapStyle: 'light' as never,
  flat: false,
  ...overrides,
});

const fullQueue = (n: number) =>
  Array.from({ length: n }, (_, i) => request({ activityId: `q${i}` }));

describe('an owed drape is kept', () => {
  it('refuses a background upgrade to a queue of ordinary requests', () => {
    expect(admitToQueue(fullQueue(30), request({ backgroundUpgrade: true }), 30)).toEqual({
      admit: false,
      evict: null,
    });
  });

  it('admits an ordinary request to a full queue by evicting the oldest non-priority one', () => {
    const queue = [request({ activityId: 'p', priority: true }), ...fullQueue(29)];
    expect(admitToQueue(queue, request({ activityId: 'new' }), 30)).toEqual({
      admit: true,
      evict: 1,
    });
  });

  it('admits into a queue with room and evicts nothing', () => {
    expect(admitToQueue(fullQueue(29), request({ backgroundUpgrade: true }), 30)).toEqual({
      admit: true,
      evict: null,
    });
  });

  it('records a refused drape once, newest last, bounded', () => {
    const owed = new Map<string, SnapshotRequest>();
    recordOwedDrape(owed, request({ activityId: 'a' }), 2);
    recordOwedDrape(owed, request({ activityId: 'b' }), 2);
    recordOwedDrape(owed, request({ activityId: 'a' }), 2);
    expect([...owed.keys()]).toEqual([
      requestKey(request({ activityId: 'b' })),
      requestKey(request({ activityId: 'a' })),
    ]);
    recordOwedDrape(owed, request({ activityId: 'c' }), 2);
    expect(owed.size).toBe(2);
    expect(owed.has(requestKey(request({ activityId: 'b' })))).toBe(false);
  });

  it('retries owed drapes as upgrades after the attempts were spent, without duplicates', () => {
    const attempts = new Map<string, number>();
    const owedRequest = request({ activityId: 'o', backgroundUpgrade: true });
    for (let i = 0; i < MAX_UPGRADE_ATTEMPTS; i++) {
      allowUpgradeAttempt(attempts, { ...owedRequest, upgrade: true });
    }
    expect(allowUpgradeAttempt(attempts, { ...owedRequest, upgrade: true })).toBe(false);

    const owed = new Map([[requestKey(owedRequest), owedRequest]]);
    const failedAndOwed = request({ activityId: 'f' });
    owed.set(requestKey(failedAndOwed), failedAndOwed);

    attempts.clear();
    const out = retryRequests([failedAndOwed], owed);

    expect(out.map((r) => r.activityId)).toEqual(['f', 'o']);
    expect(out[0]?.upgrade).toBeUndefined();
    expect(out[1]?.upgrade).toBe(true);
    expect(allowUpgradeAttempt(attempts, out[1] as SnapshotRequest)).toBe(true);
  });

  it('retries nothing when nothing failed and nothing is owed', () => {
    expect(retryRequests([], new Map())).toEqual([]);
  });
});
