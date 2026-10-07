/**
 * Scenario: the worker page counts 429 and 503 tile responses from boot and
 * each render posted that running total, so one throttle early in a session
 * made every later rejection report one and paused the whole pool again.
 *
 * Expected behaviour: a render reports only the throttles it saw itself.
 */

import { bootWorkerPage } from '../__shared__/snapshotWorkerPage';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const request = (mapStyle: SnapshotRequest['mapStyle']): SnapshotRequest => ({
  activityId: `ride-${mapStyle}`,
  coordinates: [
    [8.5, 47.4],
    [8.6, 47.5],
  ],
  camera: { center: [8.55, 47.45], zoom: 12, bearing: 0, pitch: 0 },
  mapStyle,
  routeColor: '#ff0000',
  flat: true,
});

const tileError = (status: number) => ({
  sourceId: 'vector',
  error: { status, message: `HTTP ${status}` },
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each([
  ['a full setStyle', 'satellite'],
  ['the fast path', 'dark'],
] as const)(
  'reports no throttle from a render after a throttled one, through %s',
  (_path, secondStyle) => {
    const page = bootWorkerPage();

    page.render(request('dark'), 1);
    page.map.emit('error', tileError(503));
    page.map.emit('error', tileError(429));
    jest.advanceTimersByTime(300);
    expect(page.posted).toHaveLength(1);
    expect(page.posted[0]).toMatchObject({ type: 'snapshotError', gen: 1, tileThrottles: 2 });

    page.render(request(secondStyle), 2);
    page.map.emit('error', tileError(500));
    page.map.emit('error', tileError(500));
    // The fast path listens for idle a frame after the camera jump, then
    // again once the route is on.
    jest.advanceTimersByTime(20);
    page.map.emit('idle');
    page.map.emit('idle');
    jest.advanceTimersByTime(300);

    expect(page.map.setStyle).toHaveBeenCalledTimes(secondStyle === 'dark' ? 1 : 2);
    expect(page.posted).toHaveLength(2);
    expect(page.posted[1]).toMatchObject({
      type: 'snapshotError',
      gen: 2,
      tileErrors: 2,
      tileThrottles: 0,
    });
  }
);
