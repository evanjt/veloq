import { visibleInsetScript } from '@/features/maps/lib/htmlBuilders/shared';

type Pt = [number, number];
interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const WIDTH = 1000;
const HEIGHT = 2000;
const NONE: Inset = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * A camera over a flat ground in pixel units. The centre sits at the middle of the padded frame, and
 * a screen row away from it lands on the ground stretched by 1 / cos(pitch), as a tilted view does.
 */
function makeMap(initial: { center: Pt; pitch: number }) {
  const state = { center: initial.center, pitch: initial.pitch, padding: NONE };
  const frameMiddle = (inset: Inset): Pt => [
    (inset.left + WIDTH - inset.right) / 2,
    (inset.top + HEIGHT - inset.bottom) / 2,
  ];
  const stretch = () => 1 / Math.cos((state.pitch * Math.PI) / 180);
  const map = {
    state,
    getContainer: () => ({ clientWidth: WIDTH, clientHeight: HEIGHT }),
    getCenter: () => state.center,
    getZoom: () => 12,
    getBearing: () => 0,
    getPitch: () => state.pitch,
    unproject: ([x, y]: Pt): Pt => {
      const [mx, my] = frameMiddle(state.padding);
      return [state.center[0] + (x - mx), state.center[1] + (y - my) * stretch()];
    },
    cameraForBounds: (bounds: [Pt, Pt], options: { padding: Inset }) => {
      const middle: Pt = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
      const shift = (options.padding.top - options.padding.bottom) / 2;
      return { center: [middle[0], middle[1] - shift] as Pt, zoom: 12 };
    },
    jumpTo: (options: { center?: Pt; pitch?: number; padding?: Inset }) => {
      if (options.center) state.center = options.center;
      if (options.pitch !== undefined) state.pitch = options.pitch;
      if (options.padding) state.padding = options.padding;
    },
    easeTo: () => {
      throw new Error('a zero duration moves with jumpTo');
    },
  };
  return { map, frameMiddle };
}

interface InsetPage {
  _veloqFitInset: (bounds: [Pt, Pt], inset: Inset, duration: number) => void;
  _veloqSetInset: (inset: Inset, duration: number, from?: Inset) => void;
}

function loadPage(map: ReturnType<typeof makeMap>['map']): InsetPage {
  const page = { map } as unknown as InsetPage;
  new Function('window', visibleInsetScript())(page);
  return page;
}

describe('padded camera under tilt', () => {
  const bounds: [Pt, Pt] = [
    [400, 800],
    [600, 1000],
  ];
  const trackMiddle: Pt = [500, 900];
  const sheetCovers: Inset = { top: 0, right: 0, bottom: 900, left: 0 };

  it('fits a track so its middle is the camera centre at any pitch', () => {
    for (const pitch of [0, 45, 70]) {
      const { map } = makeMap({ center: [500, 900], pitch });
      const page = loadPage(map);
      page._veloqFitInset(bounds, sheetCovers, 0);
      expect(map.state.padding).toEqual(sheetCovers);
      expect(map.state.center[0]).toBeCloseTo(trackMiddle[0], 6);
      expect(map.state.center[1]).toBeCloseTo(trackMiddle[1], 6);
      expect(map.state.pitch).toBe(pitch);
    }
  });

  it('pads an opening fit so its middle is the camera centre at any pitch', () => {
    for (const pitch of [0, 45, 70]) {
      const { map } = makeMap({ center: [500, 900], pitch });
      const page = loadPage(map);
      map.state.center = map.cameraForBounds(bounds, { padding: sheetCovers }).center;
      page._veloqSetInset(sheetCovers, 0, sheetCovers);
      expect(map.state.center[0]).toBeCloseTo(trackMiddle[0], 6);
      expect(map.state.center[1]).toBeCloseTo(trackMiddle[1], 6);
    }
  });
});
