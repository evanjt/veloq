/**
 * Scenario: the snapshot page drew the camera a request carried, whose zoom is worked out in
 * world degrees without the frame, so a short route filled a small part of the card.
 *
 * Expected behaviour: for every render that does not carry a saved camera, the page fits the
 * route to the frame less the request's inset at the camera's own pitch, flat or 3D, and a
 * camera the terrain turns is fitted before it is drawn. A saved camera is drawn as given.
 */

import { bootWorkerPage } from '../../__shared__/snapshotWorkerPage';
import type { WorkerPage } from '../../__shared__/snapshotWorkerPage';
import { HEIGHT, WIDTH } from '../../__shared__/perspectiveMap';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const LAT = 47;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT * Math.PI) / 180);
const INSET = { top: 12, right: 40, bottom: 12, left: 40 };

// A straight east-west route about 1 km long, centred on the origin.
const ROUTE: [number, number][] = Array.from({ length: 20 }, (_, i) => [
  (i - 9.5) * (50 / M_PER_DEG_LNG),
  LAT,
]);

function request(overrides: Partial<SnapshotRequest> = {}): SnapshotRequest {
  return {
    activityId: 'a1',
    coordinates: ROUTE,
    camera: { center: [0, LAT], zoom: 13, bearing: 0, pitch: 60 },
    fitInset: INSET,
    mapStyle: 'dark',
    ...overrides,
  };
}

function settle(page: WorkerPage, req: SnapshotRequest) {
  page.render(req, 1);
  jest.advanceTimersByTime(1500);
}

/** Where the page left the camera, and the route's screen box under it. */
function drawn(page: WorkerPage) {
  const screen = ROUTE.map((point) => page.map.project(point));
  const xs = screen.map((p) => p.x);
  const ys = screen.map((p) => p.y);
  return {
    x: [Math.min(...xs), Math.max(...xs)],
    y: [Math.min(...ys), Math.max(...ys)],
  };
}

function expectFitted(page: WorkerPage, inset = INSET) {
  const box = drawn(page);
  expect(box.x[0]).toBeGreaterThanOrEqual(inset.left - 0.5);
  expect(box.x[1]).toBeLessThanOrEqual(WIDTH - inset.right + 0.5);
  expect(box.y[0]).toBeGreaterThanOrEqual(inset.top - 0.5);
  expect(box.y[1]).toBeLessThanOrEqual(HEIGHT - inset.bottom + 0.5);
  const reachesWidth = Math.abs(box.x[1] - box.x[0] - (WIDTH - inset.left - inset.right)) <= 2;
  const reachesHeight = Math.abs(box.y[1] - box.y[0] - (HEIGHT - inset.top - inset.bottom)) <= 2;
  expect(reachesWidth || reachesHeight).toBe(true);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('the snapshot page fits the route to the frame', () => {
  it('zooms a 3D render in until the route reaches the inset', () => {
    const page = bootWorkerPage({ queryTerrainElevation: jest.fn(() => 0) });
    settle(page, request());

    expect(page.map.jumpTo.mock.calls.at(-1)?.[0]).not.toEqual(
      expect.objectContaining({ zoom: 13 })
    );
    expect(page.map.getZoom()).toBeGreaterThan(13);
    expect(page.map.getPitch()).toBe(60);
    expectFitted(page);
    expect(page.posted.some((m) => m.type === 'snapshot')).toBe(true);
  });

  it('fits a flat render at pitch 0', () => {
    const page = bootWorkerPage();
    settle(
      page,
      request({ flat: true, camera: { center: [0, LAT], zoom: 13, bearing: 0, pitch: 0 } })
    );

    expect(page.map.getZoom()).toBeGreaterThan(13);
    expect(page.map.getPitch()).toBe(0);
    expectFitted(page);
  });

  it('fits a render that jumps over a style the page already holds', () => {
    const page = bootWorkerPage({ queryTerrainElevation: jest.fn(() => 0) });
    settle(page, request());
    page.map.getSource.mockImplementation((id: string) => (id === 'terrain' ? {} : null));
    page.map.jumpTo({ zoom: 10, padding: { top: 0, right: 0, bottom: 0, left: 0 } });

    page.render(request({ activityId: 'a2' }), 2);
    jest.advanceTimersByTime(1500);

    expect(page.posted.filter((m) => m.type === 'snapshot')).toHaveLength(2);
    expectFitted(page);
  });

  it('draws a saved camera as given, once, and never projects', () => {
    const page = bootWorkerPage({ queryTerrainElevation: jest.fn(() => 0) });
    const project = jest.spyOn(page.map, 'project');
    settle(page, request({ cameraPinned: true }));

    expect(page.map.jumpTo).toHaveBeenCalledTimes(1);
    expect(page.map.jumpTo.mock.calls[0][0]).toEqual(
      expect.objectContaining({ zoom: 13, bearing: 0, pitch: 60 })
    );
    expect(project).not.toHaveBeenCalled();
  });

  it('fits to the marker radius alone when the request carries no inset', () => {
    const page = bootWorkerPage({ queryTerrainElevation: jest.fn(() => 0) });
    const { fitInset: _omitted, ...bare } = request();
    settle(page, bare);

    const radius = 8.5 * 0.75;
    const box = drawn(page);
    expect(box.x[0]).toBeGreaterThanOrEqual(radius - 0.5);
    expect(box.x[1]).toBeLessThanOrEqual(WIDTH - radius + 0.5);
    expect(box.x[1] - box.x[0]).toBeGreaterThan(WIDTH - 2 * radius - 2);
  });

  it('fits the camera the terrain turns to before it draws it', () => {
    // A wall just south of the route hides it from the request's eye and not from the turned one.
    const wall = jest.fn(([lng, lat]: [number, number]) => {
      const north = (lat - LAT) * M_PER_DEG_LAT;
      return north < -20 && north > -90 && lng * M_PER_DEG_LNG > -600 ? 400 : 0;
    });
    const page = bootWorkerPage({ queryTerrainElevation: wall });
    settle(page, request());

    expect(page.map.getBearing()).toBe(180);
    expect(page.map.getPitch()).toBe(60);
    expectFitted(page);
    expect(page.posted.some((m) => m.type === 'snapshot')).toBe(true);
  });
});
