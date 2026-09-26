/**
 * Scenario: a card whose terrain drape timed out and was served as a flat
 * stand-in. The athlete comes back on a better connection.
 *
 * Expected behaviour: the card asks again, and stops asking after a few tries
 * so a host that is throttling is not hammered (B418). The image on screen is
 * never taken away to do it (B416), which is why the serving gate and the
 * re-request gate have to disagree.
 */

import {
  allowUpgradeAttempt,
  MAX_UPGRADE_ATTEMPTS,
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
  routeColor: '#ff0000',
  flat: false,
  ...overrides,
});

describe('a downgraded preview asks again, within a cap', () => {
  it('lets an ordinary request through and spends nothing', () => {
    const attempts = new Map<string, number>();

    expect(allowUpgradeAttempt(attempts, request())).toBe(true);
    expect(attempts.size).toBe(0);
  });

  it('lets an upgrade through until the cap is spent', () => {
    const attempts = new Map<string, number>();

    for (let i = 0; i < MAX_UPGRADE_ATTEMPTS; i++) {
      expect(allowUpgradeAttempt(attempts, request({ upgrade: true }))).toBe(true);
    }

    expect(allowUpgradeAttempt(attempts, request({ upgrade: true }))).toBe(false);
  });

  it('counts per render identity, so another style has its own budget', () => {
    const attempts = new Map<string, number>();
    for (let i = 0; i < MAX_UPGRADE_ATTEMPTS; i++) {
      allowUpgradeAttempt(attempts, request({ upgrade: true }));
    }

    expect(allowUpgradeAttempt(attempts, request({ upgrade: true }))).toBe(false);
    expect(
      allowUpgradeAttempt(attempts, request({ upgrade: true, mapStyle: 'satellite' as never }))
    ).toBe(true);
    expect(allowUpgradeAttempt(attempts, request({ upgrade: true, activityId: 'a2' }))).toBe(true);
  });

  it('never blocks an ordinary request for a card whose upgrades are spent', () => {
    const attempts = new Map<string, number>();
    for (let i = 0; i < MAX_UPGRADE_ATTEMPTS + 2; i++) {
      allowUpgradeAttempt(attempts, request({ upgrade: true }));
    }

    expect(allowUpgradeAttempt(attempts, request())).toBe(true);
  });
});
