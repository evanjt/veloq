/**
 * A camera over a ground of x east and y south in units that are pixels at zoom 12, for the
 * pages whose fit reads `project`, `unproject` and `cameraForBounds`.
 */
export type Pt = [number, number];
export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const WIDTH = 360;
export const HEIGHT = 240;
const NONE: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
const EYE = HEIGHT * 1.5;

export interface FakeOptions {
  pitch: number;
  elevation?: (point: Pt) => number;
  /** Pixels at zoom 12 per ground unit, so a page can hand it longitude and latitude. */
  unit?: number;
}

/**
 * A camera over a ground of x east and y south in units that are pixels at zoom 12. The eye sits
 * half the frame height over tan(fov / 2) back from the centre, pitched and turned, so a point
 * further from the camera lands closer together on screen. `cameraForBounds` is exact at pitch 0
 * and ignores the pitch the camera has, as the library's does not account for it.
 */
export function makePerspectiveMap({ pitch, elevation = () => 0, unit = 1 }: FakeOptions) {
  const state = { center: [0, 0] as Pt, zoom: 12, bearing: 0, pitch, padding: NONE };
  const frameMiddle = (inset: Inset): Pt => [
    (inset.left + WIDTH - inset.right) / 2,
    (inset.top + HEIGHT - inset.bottom) / 2,
  ];
  const scale = () => 2 ** (state.zoom - 12);
  const turn = (east: number, north: number, bearing: number): Pt => [
    east * Math.cos(bearing) - north * Math.sin(bearing),
    east * Math.sin(bearing) + north * Math.cos(bearing),
  ];
  const map = {
    state,
    getContainer: () => ({ clientWidth: WIDTH, clientHeight: HEIGHT }),
    getCenter: () => state.center,
    getZoom: () => state.zoom,
    getBearing: () => state.bearing,
    getPitch: () => state.pitch,
    project: (point: Pt): { x: number; y: number } => {
      const p = (state.pitch * Math.PI) / 180;
      const b = (state.bearing * Math.PI) / 180;
      const [u, v] = turn(
        (point[0] - state.center[0]) * unit,
        -(point[1] - state.center[1]) * unit,
        b
      );
      const right = u * scale();
      const forward = v * scale();
      const height = elevation(point) * scale();
      const depth = forward * Math.sin(p) + EYE - height * Math.cos(p);
      const [mx, my] = frameMiddle(state.padding);
      return {
        x: mx + (EYE * right) / depth,
        y: my - (EYE * (forward * Math.cos(p) + height * Math.sin(p))) / depth,
      };
    },
    unproject: ([x, y]: Pt): Pt => {
      const p = (state.pitch * Math.PI) / 180;
      const b = (state.bearing * Math.PI) / 180;
      const [mx, my] = frameMiddle(state.padding);
      const up = -(y - my);
      const forward = (up * EYE) / (EYE * Math.cos(p) - up * Math.sin(p));
      const depth = forward * Math.sin(p) + EYE;
      const right = ((x - mx) * depth) / EYE;
      const [east, north] = turn(right / scale(), forward / scale(), -b);
      return [state.center[0] + east / unit, state.center[1] - north / unit];
    },
    cameraForBounds: (bounds: [Pt, Pt], options: { padding: Inset; bearing: number }) => {
      const b = (options.bearing * Math.PI) / 180;
      const corners: Pt[] = [
        [bounds[0][0] * unit, bounds[0][1] * unit],
        [bounds[1][0] * unit, bounds[0][1] * unit],
        [bounds[1][0] * unit, bounds[1][1] * unit],
        [bounds[0][0] * unit, bounds[1][1] * unit],
      ];
      const turned = corners.map((c) => turn(c[0], -c[1], b));
      const us = turned.map((c) => c[0]);
      const vs = turned.map((c) => c[1]);
      const width = Math.max(...us) - Math.min(...us);
      const length = Math.max(...vs) - Math.min(...vs);
      const room = [
        WIDTH - options.padding.left - options.padding.right,
        HEIGHT - options.padding.top - options.padding.bottom,
      ];
      const fit = Math.min(room[0] / width, room[1] / length);
      const midU = (Math.max(...us) + Math.min(...us)) / 2;
      const midV = (Math.max(...vs) + Math.min(...vs)) / 2;
      const offsetX = (options.padding.left - options.padding.right) / 2;
      const offsetY = (options.padding.top - options.padding.bottom) / 2;
      const [east, north] = turn(midU - offsetX / fit, midV + offsetY / fit, -b);
      return { center: [east / unit, -north / unit] as Pt, zoom: 12 + Math.log2(fit) };
    },
    jumpTo: (o: {
      center?: Pt;
      zoom?: number;
      bearing?: number;
      pitch?: number;
      padding?: Inset;
    }) => {
      if (o.center) state.center = o.center;
      if (o.zoom !== undefined) state.zoom = o.zoom;
      if (o.bearing !== undefined) state.bearing = o.bearing;
      if (o.pitch !== undefined) state.pitch = o.pitch;
      if (o.padding) state.padding = o.padding;
    },
    easeTo: () => {
      throw new Error('a zero duration moves with jumpTo');
    },
  };
  return { map, frameMiddle };
}
