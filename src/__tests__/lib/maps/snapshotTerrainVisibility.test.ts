/**
 * Scenario: a 3D preview is drawn from a camera that looks across the route.
 * A ridge between that eye and the far half of the route hides it.
 *
 * Expected behaviour: the page reads the terrain it has loaded, and turns to
 * the least hidden of the request camera, its three quarter turns and pitch
 * 40 before it captures. A flat render and a clear route are left alone.
 */

import { bootWorkerPage } from '../../__shared__/snapshotWorkerPage';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const LAT = 47;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT * Math.PI) / 180);

// A straight east-west route about 2 km long, centred on the origin.
const ROUTE: [number, number][] = Array.from({ length: 40 }, (_, i) => [
  (i - 19.5) * (50 / M_PER_DEG_LNG),
  LAT,
]);
const CENTRE: [number, number] = [0, LAT];

function request(overrides: Partial<SnapshotRequest> = {}): SnapshotRequest {
  return {
    activityId: 'a1',
    coordinates: ROUTE,
    camera: { center: CENTRE, zoom: 13, bearing: 0, pitch: 60 },
    mapStyle: 'dark',
    routeColor: '#ff0000',
    ...overrides,
  };
}

// Metres north of the route, where a bearing-0 camera's eye is not: it sits south.
function ridgeNorthOfRoute(height: number, fromEast = 0) {
  return jest.fn(([lng, lat]: [number, number]) => {
    const north = (lat - LAT) * M_PER_DEG_LAT;
    const east = lng * M_PER_DEG_LNG;
    // The camera at bearing 0 sits south of the route looking north. A wall
    // just south of the route hides the east half from that eye only when it
    // stands between them, so the ridge is placed south and east of centre.
    return north < -150 && north > -450 && east > fromEast ? height : 0;
  });
}

function renderAndSettle(page: ReturnType<typeof bootWorkerPage>, req: SnapshotRequest) {
  page.render(req, 1);
  jest.advanceTimersByTime(1000);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('terrain visibility check', () => {
  it('turns 180 when a ridge hides the route from the request camera', () => {
    const page = bootWorkerPage({ queryTerrainElevation: ridgeNorthOfRoute(300) });
    renderAndSettle(page, request());
    const camera = page.map.jumpTo.mock.calls.at(-1)?.[0];
    expect(page.map.jumpTo.mock.calls.length).toBeGreaterThan(1);
    expect(camera.bearing).toBe(180);
    expect(camera.pitch).toBe(60);
    expect(page.posted.some((m) => m.type === 'snapshot')).toBe(true);
  });

  it('keeps the request camera over flat ground', () => {
    const page = bootWorkerPage({ queryTerrainElevation: jest.fn(() => 0) });
    renderAndSettle(page, request());
    expect(page.map.jumpTo).toHaveBeenCalledTimes(1);
    expect(page.map.jumpTo.mock.calls[0][0].bearing).toBe(0);
    expect(page.posted.some((m) => m.type === 'snapshot')).toBe(true);
  });

  it('never reads the terrain on a flat render', () => {
    const query = jest.fn(() => 500);
    const page = bootWorkerPage({ queryTerrainElevation: query });
    renderAndSettle(page, request({ flat: true }));
    expect(query).not.toHaveBeenCalled();
    expect(page.map.jumpTo).toHaveBeenCalledTimes(1);
  });

  it('counts a point with no loaded terrain as clear', () => {
    const page = bootWorkerPage({ queryTerrainElevation: jest.fn(() => undefined) });
    renderAndSettle(page, request());
    expect(page.map.jumpTo).toHaveBeenCalledTimes(1);
  });

  it('picks pitch 40 when every bearing is hidden and a lower eye is not', () => {
    // A square wall round the route, tall enough to hide it from a 60 degree
    // eye on every side and low enough that a 40 degree eye looks over it.
    const ring = jest.fn(([lng, lat]: [number, number]) => {
      const north = (lat - LAT) * M_PER_DEG_LAT;
      const east = lng * M_PER_DEG_LNG;
      const edge = Math.max(Math.abs(north), Math.abs(east));
      return edge > 1100 && edge < 1250 ? 900 : 0;
    });
    const page = bootWorkerPage({ queryTerrainElevation: ring });
    renderAndSettle(page, request());
    const camera = page.map.jumpTo.mock.calls.at(-1)?.[0];
    expect(camera.pitch).toBe(40);
    expect(camera.bearing).toBe(0);
  });
});

it('never turns a camera the athlete saved', () => {
  const page = bootWorkerPage({ queryTerrainElevation: ridgeNorthOfRoute(300) });
  renderAndSettle(page, request({ cameraPinned: true }));
  expect(page.map.jumpTo).toHaveBeenCalledTimes(1);
});
