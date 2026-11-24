import vm from 'vm';
import { terrainVisibilityScript } from '@/features/maps/lib/htmlBuilders/shared';

type Camera = { center: [number, number]; zoom: number; bearing: number; pitch: number };

function load(): (...args: unknown[]) => Camera {
  const sandbox: { window: Record<string, unknown>; Math: Math } = { window: {}, Math };
  vm.createContext(sandbox);
  vm.runInContext(terrainVisibilityScript(), sandbox);
  return sandbox.window._pickUnhiddenCamera as (...args: unknown[]) => Camera;
}

describe('terrain visibility camera pick', () => {
  const camera: Camera = { center: [7.0, 46.0], zoom: 12, bearing: 0, pitch: 60 };
  const coords = [
    [7.0, 46.0],
    [7.001, 46.001],
    [7.002, 46.002],
  ];
  const spans = [0.05, 0.05];

  // A ridge between the south eye and the route hides it from the request bearing only.
  function map(ridgeSouth: boolean) {
    return {
      transform: { fov: 36.87, height: 600 },
      queryTerrainElevation: ([, lat]: [number, number]) => (ridgeSouth && lat < 46.0 ? 3000 : 0),
    };
  }

  it('keeps the request centre on every turned candidate when there is no fit', () => {
    const pick = load();
    const result = pick(map(true), camera, coords, spans);
    expect(result.bearing).not.toBe(camera.bearing);
    expect(result.center).toEqual(camera.center);
  });
});
