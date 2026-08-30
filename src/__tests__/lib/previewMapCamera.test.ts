/**
 * Scenario: a preview run over one riding area can return sections belonging to
 * a geographic component that reaches far past that area.
 *
 * Expected behaviour: the camera stays on the selected area's ~5 km bin. It
 * tightens onto the geometry that falls inside the bin and never grows to frame
 * the rest of the result.
 */
import {
  PREVIEW_AREA_BOUNDS_PADDING,
  PREVIEW_BIN_DEG,
  PREVIEW_MIN_EXTENT_DEG,
  previewAreaAnchor,
  previewAreaBounds,
  previewCameraBounds,
} from '@/features/routes/lib/previewMapCamera';
import type { LngLat } from '@/features/maps/lib/coordinates';

// floor(46.948 / 0.045) = 1043, floor(7.447 / 0.045) = 165.
const CENTRE = { binKey: '1043:165', lat: 46.948, lng: 7.447 };
const BIN_SW: LngLat = [165 * PREVIEW_BIN_DEG, 1043 * PREVIEW_BIN_DEG];
const BIN_NE: LngLat = [166 * PREVIEW_BIN_DEG, 1044 * PREVIEW_BIN_DEG];

const NEIGHBOUR = { binKey: '1044:166', lat: 46.99, lng: 7.49 };

const INSIDE: LngLat[] = [
  [7.44, 46.945],
  [7.45, 46.95],
];
const FAR_AWAY: LngLat[] = [
  [8.54, 47.37],
  [8.56, 47.39],
];

function within(inner: LngLat, sw: LngLat, ne: LngLat): boolean {
  return inner[0] >= sw[0] && inner[0] <= ne[0] && inner[1] >= sw[1] && inner[1] <= ne[1];
}

describe('preview area bounds', () => {
  it('is the bin box the centre key names', () => {
    const area = previewAreaBounds(CENTRE)!;

    expect(area.sw[0]).toBeCloseTo(BIN_SW[0], 9);
    expect(area.sw[1]).toBeCloseTo(BIN_SW[1], 9);
    expect(area.ne[0]).toBeCloseTo(BIN_NE[0], 9);
    expect(area.ne[1]).toBeCloseTo(BIN_NE[1], 9);
  });

  it('falls back to one bin around the point when the key is unusable', () => {
    const area = previewAreaBounds({ binKey: 'not-a-bin', lat: 46.948, lng: 7.447 })!;

    expect(area.sw[0]).toBeCloseTo(7.447 - PREVIEW_BIN_DEG / 2, 9);
    expect(area.sw[1]).toBeCloseTo(46.948 - PREVIEW_BIN_DEG / 2, 9);
    expect(area.ne[0]).toBeCloseTo(7.447 + PREVIEW_BIN_DEG / 2, 9);
    expect(area.ne[1]).toBeCloseTo(46.948 + PREVIEW_BIN_DEG / 2, 9);
  });

  it('bins a southern hemisphere centre onto the same grid the engine uses', () => {
    const area = previewAreaBounds({ binKey: '-829:3399', lat: -37.3, lng: 152.96 })!;

    expect(area.sw[1]).toBeCloseTo(-829 * PREVIEW_BIN_DEG, 9);
    expect(area.ne[1]).toBeCloseTo(-828 * PREVIEW_BIN_DEG, 9);
  });

  it('is null without a centre', () => {
    expect(previewAreaBounds(null)).toBeNull();
  });

  it('is null for a centre that is not drawable', () => {
    expect(previewAreaBounds({ binKey: null, lat: Number.NaN, lng: 7.447 })).toBeNull();
  });
});

describe('preview camera bounds', () => {
  it('frames the selected area when the run returned nothing', () => {
    const camera = previewCameraBounds(CENTRE, [])!;

    expect(camera.sw[0]).toBeCloseTo(BIN_SW[0], 9);
    expect(camera.sw[1]).toBeCloseTo(BIN_SW[1], 9);
    expect(camera.ne[0]).toBeCloseTo(BIN_NE[0], 9);
    expect(camera.ne[1]).toBeCloseTo(BIN_NE[1], 9);
  });

  it('tightens onto a single section inside the area', () => {
    const camera = previewCameraBounds(CENTRE, [INSIDE])!;

    // 0.01° x 0.005° raw, padded by 15% of its own extent.
    expect(camera.sw[0]).toBeCloseTo(7.4385, 9);
    expect(camera.sw[1]).toBeCloseTo(46.94425, 9);
    expect(camera.ne[0]).toBeCloseTo(7.4515, 9);
    expect(camera.ne[1]).toBeCloseTo(46.95075, 9);
    expect(within(camera.sw, BIN_SW, BIN_NE)).toBe(true);
    expect(within(camera.ne, BIN_SW, BIN_NE)).toBe(true);
  });

  it('stays on the area when every section is outside it', () => {
    const camera = previewCameraBounds(CENTRE, [FAR_AWAY])!;

    expect(camera.sw[0]).toBeCloseTo(BIN_SW[0], 9);
    expect(camera.sw[1]).toBeCloseTo(BIN_SW[1], 9);
    expect(camera.ne[0]).toBeCloseTo(BIN_NE[0], 9);
    expect(camera.ne[1]).toBeCloseTo(BIN_NE[1], 9);
  });

  it('ignores the portion of the result that lies outside the area', () => {
    const camera = previewCameraBounds(CENTRE, [INSIDE, FAR_AWAY])!;

    expect(camera.ne[0]).toBeCloseTo(7.4515, 9);
    expect(camera.ne[1]).toBeCloseTo(46.95075, 9);
  });

  it('never reaches past the area, however long the section running out of it', () => {
    const runsOut: LngLat[] = [
      [7.446, 46.947],
      [9.2, 48.8],
    ];

    const camera = previewCameraBounds(CENTRE, [runsOut])!;

    expect(camera.ne[0]).toBeLessThanOrEqual(BIN_NE[0]);
    expect(camera.ne[1]).toBeLessThanOrEqual(BIN_NE[1]);
    expect(camera.sw[0]).toBeGreaterThanOrEqual(BIN_SW[0]);
    expect(camera.sw[1]).toBeGreaterThanOrEqual(BIN_SW[1]);
  });

  it('holds a floor under the framed box when one point falls inside', () => {
    const camera = previewCameraBounds(CENTRE, [[[7.446, 46.947]]])!;

    expect(camera.ne[0] - camera.sw[0]).toBeCloseTo(PREVIEW_MIN_EXTENT_DEG, 9);
    expect(camera.ne[1] - camera.sw[1]).toBeCloseTo(PREVIEW_MIN_EXTENT_DEG, 9);
    expect(within(camera.sw, BIN_SW, BIN_NE)).toBe(true);
    expect(within(camera.ne, BIN_SW, BIN_NE)).toBe(true);
  });

  it('clamps the fractional padding to the area edge', () => {
    const hugsTheEdge: LngLat[] = [
      [BIN_SW[0], BIN_SW[1]],
      [BIN_NE[0], BIN_NE[1]],
    ];

    const camera = previewCameraBounds(CENTRE, [hugsTheEdge])!;

    expect(camera.sw[0]).toBeCloseTo(BIN_SW[0], 9);
    expect(camera.sw[1]).toBeCloseTo(BIN_SW[1], 9);
    expect(camera.ne[0]).toBeCloseTo(BIN_NE[0], 9);
    expect(camera.ne[1]).toBeCloseTo(BIN_NE[1], 9);
  });

  it('moves to the next area picked while the previous result is still held', () => {
    const first = previewCameraBounds(CENTRE, [INSIDE])!;
    const second = previewCameraBounds(NEIGHBOUR, [INSIDE])!;

    expect(second.sw[0]).toBeCloseTo(166 * PREVIEW_BIN_DEG, 9);
    expect(second.sw[1]).toBeCloseTo(1044 * PREVIEW_BIN_DEG, 9);
    expect(second.ne[0]).toBeCloseTo(167 * PREVIEW_BIN_DEG, 9);
    expect(second.ne[1]).toBeCloseTo(1045 * PREVIEW_BIN_DEG, 9);
    expect(second.sw[0]).toBeGreaterThan(first.ne[0]);
  });

  it('drops non-finite points rather than framing them', () => {
    const broken: LngLat[] = [
      [Number.NaN, 46.947],
      [7.44, 46.945],
      [7.45, 46.95],
    ];

    const camera = previewCameraBounds(CENTRE, [broken])!;

    expect(camera.sw[0]).toBeCloseTo(7.4385, 9);
    expect(camera.ne[0]).toBeCloseTo(7.4515, 9);
  });

  it('is null without a centre, whatever the result holds', () => {
    expect(previewCameraBounds(null, [INSIDE])).toBeNull();
  });

  it('pads by a fraction of the framed extent, not a fixed degree count', () => {
    expect(PREVIEW_AREA_BOUNDS_PADDING).toBeGreaterThan(0);
    expect(PREVIEW_AREA_BOUNDS_PADDING).toBeLessThan(1);
  });
});

describe('preview area anchor', () => {
  it('is the centre of the bin box, not the mean the engine reports', () => {
    const anchor = previewAreaAnchor({ binKey: '1043:165', lat: 46.936, lng: 7.447 })!;

    expect(anchor[0]).toBeCloseTo(165.5 * PREVIEW_BIN_DEG, 9);
    expect(anchor[1]).toBeCloseTo(1043.5 * PREVIEW_BIN_DEG, 9);
  });

  it('is the point itself when the key is unusable', () => {
    const anchor = previewAreaAnchor({ binKey: 'not-a-bin', lat: 46.948, lng: 7.447 })!;

    expect(anchor[0]).toBeCloseTo(7.447, 9);
    expect(anchor[1]).toBeCloseTo(46.948, 9);
  });

  it('is null for a centre that is not drawable', () => {
    expect(previewAreaAnchor(null)).toBeNull();
    expect(previewAreaAnchor({ binKey: null, lat: Number.NaN, lng: 7.447 })).toBeNull();
  });
});
