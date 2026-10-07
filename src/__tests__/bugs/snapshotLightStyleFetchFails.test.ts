/**
 * Scenario: a light preview used to fetch the hosted style before it mounted
 * anything, so a failed fetch left an empty map captured as a finished preview.
 *
 * Expected behaviour: the light style is bundled, so the page fetches nothing
 * and mounts it in full on every render, offline included.
 */

import { bootWorkerPage } from '../__shared__/snapshotWorkerPage';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const request = (activityId: string): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.5, 47.4],
    [8.6, 47.5],
  ],
  camera: { center: [8.55, 47.45], zoom: 12, bearing: 0, pitch: 0 },
  mapStyle: 'light',
  routeColor: '#ff0000',
  flat: true,
});

async function settle(ms: number) {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  jest.advanceTimersByTime(ms);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('mounts the bundled style without touching the network', async () => {
  const fetch = jest.fn(() => Promise.reject(new Error('Network request failed')));
  const page = bootWorkerPage({ fetch });

  page.render(request('ride-1'), 1);
  await settle(300);

  expect(fetch).not.toHaveBeenCalled();
  expect(page.map.setStyle).toHaveBeenCalledTimes(1);
  expect(Object.keys(page.map.setStyle.mock.calls[0][0].sources).length).toBeGreaterThan(0);
  expect(page.posted.some((m) => m.type === 'snapshotError')).toBe(false);
});

it('mounts the style in full again on the next light render', async () => {
  const page = bootWorkerPage({ fetch: jest.fn() });

  page.render(request('ride-1'), 1);
  await settle(300);
  page.render(request('ride-2'), 2);
  await settle(300);

  expect(page.map.setStyle.mock.calls.length).toBeGreaterThanOrEqual(1);
  expect(page.map.setStyle.mock.calls[0][0].sources).toBeDefined();
});
