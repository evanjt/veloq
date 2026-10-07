/**
 * Scenario: under the native transport the interceptor answers a tile the host
 * would not give with the status Rust hands it: 429 or 503 when the host asked
 * to be left alone, 502 when it failed, 404 for a real refusal. Until then
 * every one of them arrived as a 404, which the worker skips as out of
 * coverage, so its throttle backoff never fired on a handset.
 *
 * Expected behaviour: the worker counts each status for what it is.
 *
 * Scope: the page worker only, fed the error events the interceptor produces.
 * The native side that chooses the status (the Rust fetch result and the
 * Android and iOS interceptors) is not driven here.
 */

import { bootWorkerPage } from '../__shared__/snapshotWorkerPage';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const request: SnapshotRequest = {
  activityId: 'ride-dark',
  coordinates: [
    [8.5, 47.4],
    [8.6, 47.5],
  ],
  camera: { center: [8.55, 47.45], zoom: 12, bearing: 0, pitch: 0 },
  mapStyle: 'dark',
  routeColor: '#ff0000',
  flat: true,
};

const tileError = (status: number) => ({
  sourceId: 'openmaptiles',
  error: { status, message: `HTTP ${status}` },
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each([
  [429, { tileErrors: 2, tileThrottles: 2 }],
  [503, { tileErrors: 2, tileThrottles: 2 }],
  [502, { tileErrors: 2, tileThrottles: 0 }],
])('counts a %i from the interceptor', (status, counts) => {
  const page = bootWorkerPage();

  page.render(request, 1);
  page.map.emit('error', tileError(status));
  page.map.emit('error', tileError(status));
  jest.advanceTimersByTime(300);

  expect(page.posted[0]).toMatchObject({ type: 'snapshotError', gen: 1, ...counts });
});

it('skips a 404 from the interceptor as out of coverage', () => {
  const page = bootWorkerPage();

  page.render(request, 1);
  page.map.emit('error', tileError(404));
  page.map.emit('error', tileError(404));
  jest.advanceTimersByTime(20);
  page.map.emit('idle');
  page.map.emit('idle');
  jest.advanceTimersByTime(300);

  expect(page.posted.some((m) => m.type === 'snapshotError')).toBe(false);
});
