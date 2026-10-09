/**
 * Scenario: a satellite 3D preview was stored with a third of its frame drawn
 * as the style's own `background` layer, a flat navy that MapLibre paints
 * wherever no imagery tile drew. The gap probe looked for a hand-written blue
 * range the navy falls outside, and only sampled the middle of the frame, so a
 * whole frame of it, or a missing far corner, posted a finished `snapshot`.
 *
 * Expected behaviour: a 3D render samples a grid over the whole frame below
 * the horizon, and three samples of the satellite style's background, or of
 * pure black where a terrain tile failed, make it a `snapshotError`. On the
 * light and dark styles bare land is drawn as the background, so a frame of it
 * is a finished picture.
 */

import { bootWorkerPage } from '../__shared__/snapshotWorkerPage';
import type { WorkerPage } from '../__shared__/snapshotWorkerPage';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import type { MapStyleType } from '@/features/maps/components/mapStyles';

type Rgb = [number, number, number];

const WIDTH = 1080;
const HEIGHT = 720;

const SATELLITE_BACKGROUND: Rgb = [0x0a, 0x16, 0x28];
const DARK_BACKGROUND: Rgb = [0x0e, 0x0e, 0x0e];
const LIGHT_BACKGROUND: Rgb = [0xf8, 0xf4, 0xf0];
const BLACK: Rgb = [0, 0, 0];

/** Forest, field and scree, none of them near any style's background. */
function imagery(x: number, y: number): Rgb {
  const shades: Rgb[] = [
    [62, 88, 51],
    [141, 128, 92],
    [118, 116, 109],
  ];
  return shades[(Math.floor(x / 97) + Math.floor(y / 61)) % shades.length];
}

const request = (mapStyle: MapStyleType, pitch = 60): SnapshotRequest => ({
  activityId: 'hike-ridge',
  coordinates: [
    [9.71, 46.52],
    [9.78, 46.56],
  ],
  camera: { center: [9.745, 46.54], zoom: 12.5, bearing: 30, pitch },
  cameraPinned: true,
  mapStyle,
  routeColor: '#ff0000',
});

function capture(
  mapStyle: MapStyleType,
  pixelAt: (x: number, y: number) => Rgb,
  pitch?: number
): Record<string, unknown>[] {
  jest.useFakeTimers();
  try {
    const page: WorkerPage = bootWorkerPage({ pixelAt });
    page.render(request(mapStyle, pitch), 1);
    jest.advanceTimersByTime(400);
    return page.posted.filter((m) => m.type === 'snapshot' || m.type === 'snapshotError');
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
}

const finished = [expect.objectContaining({ type: 'snapshot', gen: 1 })];
const refused = [expect.objectContaining({ type: 'snapshotError', gen: 1 })];

/** The far top-left corner of the frame, where a pitched view's last tiles land. */
const inTopLeft = (x: number, y: number) => x / WIDTH + y / HEIGHT < 0.8;

describe('a satellite 3D render', () => {
  it('is refused when every pixel is the style background', () => {
    expect(capture('satellite', () => SATELLITE_BACKGROUND)).toEqual(refused);
  });

  it('is refused when the far top-left corner is the style background', () => {
    const pixelAt = (x: number, y: number) =>
      inTopLeft(x, y) ? SATELLITE_BACKGROUND : imagery(x, y);

    expect(capture('satellite', pixelAt)).toEqual(refused);
  });

  it('is refused when a background a shade off the style colour covers the frame', () => {
    const [r, g, b] = SATELLITE_BACKGROUND;

    expect(capture('satellite', () => [r + 3, g - 3, b + 2])).toEqual(refused);
  });

  it('is finished when no pixel is the style background', () => {
    expect(capture('satellite', imagery)).toEqual(finished);
  });

  it('is finished with two background samples, under the threshold of three', () => {
    // The grid's top row sits at an eighth of the height, its columns at a
    // tenth, three tenths and so on, so this covers its first two samples.
    const pixelAt = (x: number, y: number) =>
      y < HEIGHT / 4 && x < WIDTH * 0.4 ? SATELLITE_BACKGROUND : imagery(x, y);

    expect(capture('satellite', pixelAt)).toEqual(finished);
  });

  it('does not count the sky above the horizon of a steep camera', () => {
    // At pitch 80 under a 36.87 degree field of view the horizon crosses the
    // frame about a quarter of the way down, so the grid's top row is sky.
    const pixelAt = (x: number, y: number) =>
      y < HEIGHT * 0.2 ? SATELLITE_BACKGROUND : imagery(x, y);

    expect(capture('satellite', pixelAt, 80)).toEqual(finished);
  });

  it('counts the same row as ground at the pitch the feed draws', () => {
    const pixelAt = (x: number, y: number) =>
      y < HEIGHT * 0.2 ? SATELLITE_BACKGROUND : imagery(x, y);

    expect(capture('satellite', pixelAt, 60)).toEqual(refused);
  });
});

describe.each([
  ['dark', DARK_BACKGROUND],
  ['light', LIGHT_BACKGROUND],
] as const)('a %s 3D render', (mapStyle, background) => {
  it('is finished when every pixel is the style background, which is bare land', () => {
    expect(capture(mapStyle, () => background)).toEqual(finished);
  });

  it('is finished when the far top-left corner is the style background', () => {
    const pixelAt = (x: number, y: number) => (inTopLeft(x, y) ? background : imagery(x, y));

    expect(capture(mapStyle, pixelAt)).toEqual(finished);
  });

  it('is refused when the far top-left corner is pure black, a failed terrain tile', () => {
    const pixelAt = (x: number, y: number) => (inTopLeft(x, y) ? BLACK : imagery(x, y));

    expect(capture(mapStyle, pixelAt)).toEqual(refused);
  });

  it('is finished when no pixel is a gap', () => {
    expect(capture(mapStyle, imagery)).toEqual(finished);
  });
});

it('refuses a satellite render whose far corner is pure black', () => {
  const pixelAt = (x: number, y: number) => (inTopLeft(x, y) ? BLACK : imagery(x, y));

  expect(capture('satellite', pixelAt)).toEqual(refused);
});
