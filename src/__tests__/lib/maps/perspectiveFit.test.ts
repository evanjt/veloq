import { visibleInsetScript } from '@/features/maps/lib/htmlBuilders/shared';

import { makePerspectiveMap, HEIGHT, WIDTH } from '../../__shared__/perspectiveMap';
import type { Inset, Pt } from '../../__shared__/perspectiveMap';

const INSET: Inset = { top: 12, right: 12, bottom: 12, left: 12 };

interface FitPage {
  _veloqFitInset: (
    points: Pt[],
    inset: Inset,
    duration: number,
    options?: { bearing?: number; maxZoom?: number }
  ) => void;
}

function loadPage(map: ReturnType<typeof makePerspectiveMap>['map']): FitPage {
  const page = { map } as unknown as FitPage;
  new Function('window', visibleInsetScript())(page);
  return page;
}

function spanOf(
  map: ReturnType<typeof makePerspectiveMap>['map'],
  points: Pt[]
): { x: [number, number]; y: [number, number] } {
  const screen = points.map((p) => map.project(p));
  const xs = screen.map((p) => p.x);
  const ys = screen.map((p) => p.y);
  return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
}

function line(from: Pt, to: Pt, count: number): Pt[] {
  return Array.from({ length: count }, (_, i) => [
    from[0] + ((to[0] - from[0]) * i) / (count - 1),
    from[1] + ((to[1] - from[1]) * i) / (count - 1),
  ]);
}

function expectInsideInset(span: ReturnType<typeof spanOf>) {
  expect(span.x[0]).toBeGreaterThanOrEqual(INSET.left - 0.5);
  expect(span.x[1]).toBeLessThanOrEqual(WIDTH - INSET.right + 0.5);
  expect(span.y[0]).toBeGreaterThanOrEqual(INSET.top - 0.5);
  expect(span.y[1]).toBeLessThanOrEqual(HEIGHT - INSET.bottom + 0.5);
}

function reachesInset(span: ReturnType<typeof spanOf>): boolean {
  const width = span.x[1] - span.x[0];
  const height = span.y[1] - span.y[0];
  return (
    Math.abs(width - (WIDTH - INSET.left - INSET.right)) <= 2 ||
    Math.abs(height - (HEIGHT - INSET.top - INSET.bottom)) <= 2
  );
}

describe('fit at the map pitch', () => {
  const northSouth: [Pt, Pt] = [
    [0, 0],
    [0, 1000],
  ];

  it('fills the frame less the inset with a pitched view of a straight route', () => {
    const { map } = makePerspectiveMap({ pitch: 60 });
    const page = loadPage(map);
    page._veloqFitInset(northSouth, INSET, 0);
    const span = spanOf(map, line(northSouth[0], northSouth[1], 50));
    expectInsideInset(span);
    expect(reachesInset(span)).toBe(true);
    expect(map.state.pitch).toBe(60);
  });

  it('gives the library fit at pitch 0, unchanged', () => {
    const { map } = makePerspectiveMap({ pitch: 0 });
    const expected = map.cameraForBounds(northSouth, { padding: INSET, bearing: 0 });
    const page = loadPage(map);
    page._veloqFitInset(northSouth, INSET, 0);
    expect(map.state.zoom).toBeCloseTo(expected.zoom, 9);
    const middle = map.unproject([WIDTH / 2, HEIGHT / 2]);
    expect(middle[0]).toBeCloseTo(0, 6);
    expect(middle[1]).toBeCloseTo(500, 6);
  });

  it('fits a route given as points tighter than its bounds corners', () => {
    const route = line([0, 800], [800, 0], 200);
    const corners: [Pt, Pt] = [
      [0, 0],
      [800, 800],
    ];

    const cornerMap = makePerspectiveMap({ pitch: 60 });
    loadPage(cornerMap.map)._veloqFitInset(corners, INSET, 0);

    const routeMap = makePerspectiveMap({ pitch: 60 });
    loadPage(routeMap.map)._veloqFitInset(route, INSET, 0);

    expect(routeMap.map.state.zoom).toBeGreaterThan(cornerMap.map.state.zoom + 0.1);
    const span = spanOf(routeMap.map, route);
    expectInsideInset(span);
    expect(reachesInset(span)).toBe(true);
  });

  it('keeps a route whose far end is raised inside the inset', () => {
    const elevation = (point: Pt) => 300 * Math.max(0, 1 - point[1] / 1000);
    const route = line(northSouth[0], northSouth[1], 200);
    const { map } = makePerspectiveMap({ pitch: 60, elevation });
    loadPage(map)._veloqFitInset(route, INSET, 0);
    expectInsideInset(spanOf(map, route));
  });

  it('turns to the requested bearing and fits the route at it', () => {
    const route = line([0, 0], [1000, 0], 100);
    const { map } = makePerspectiveMap({ pitch: 60 });
    loadPage(map)._veloqFitInset(route, INSET, 0, { bearing: 90 });
    expect(map.state.bearing).toBe(90);
    expectInsideInset(spanOf(map, route));
  });

  it('caps the fitted zoom at maxZoom', () => {
    const route = line([0, 0], [0, 10], 20);
    const { map } = makePerspectiveMap({ pitch: 60 });
    loadPage(map)._veloqFitInset(route, INSET, 0, { maxZoom: 13 });
    expect(map.state.zoom).toBeLessThanOrEqual(13 + 1e-9);
  });
});
