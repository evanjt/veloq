/**
 * Scenario: MapLibre keeps an errored tile in its source cache and fires no
 * error for a tile that answered 404, so a render can finish with a hole and
 * no event. A retry on the same map keeps that tile and never asks again.
 *
 * Expected behaviour: a render with an errored in-view tile posts no snapshot,
 * and the retry runs on a rebuilt map.
 */

import { bootWorkerPage } from '../__shared__/snapshotWorkerPage';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const request: SnapshotRequest = {
  activityId: 'ride-dark-3d',
  coordinates: [
    [8.5, 47.4],
    [8.6, 47.5],
  ],
  camera: { center: [8.55, 47.45], zoom: 12, bearing: 0, pitch: 60 },
  mapStyle: 'dark',
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function finish(page: ReturnType<typeof bootWorkerPage>) {
  jest.advanceTimersByTime(300);
  page.map.emit('idle');
  jest.advanceTimersByTime(2000);
}

it('refuses a picture with an errored tile that fired no error', () => {
  const page = bootWorkerPage();
  page.map.sourceTiles = { openmaptiles: ['loaded', 'errored'], terrain: ['loaded'] };

  page.render(request, 1);
  finish(page);

  expect(page.posted.some((m) => m.type === 'snapshot')).toBe(false);
  expect(page.posted[0]).toMatchObject({ type: 'snapshotError', gen: 1 });
});

it('ignores an errored tile of a regional satellite source', () => {
  const page = bootWorkerPage();
  page.map.sourceTiles = { 'satellite-regions': ['errored'], terrain: ['loaded'] };

  page.render(request, 1);
  finish(page);

  expect(page.posted.some((m) => m.type === 'snapshot')).toBe(true);
});

it('rebuilds the map after an error with tile errors, so the retry asks again', () => {
  const page = bootWorkerPage();
  const before = page.mapsBuilt();

  page.render(request, 1);
  page.map.emit('error', { sourceId: 'openmaptiles', error: { status: 502, message: 'HTTP 502' } });
  finish(page);

  expect(page.posted[0]).toMatchObject({ type: 'snapshotError', tileErrors: 1 });
  expect(page.mapsBuilt()).toBe(before + 1);
});
