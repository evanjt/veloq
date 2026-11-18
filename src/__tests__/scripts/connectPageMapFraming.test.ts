/**
 * Scenario: the map frames a selection beside the panels drawn over it, and frames again only
 * when asked.
 *
 * Expected behaviour: the padding on each edge covers the overlays open over the map and nothing
 * else, never leaves the map less than a share of its own size, and a frame is applied once per
 * request: the same request after a pan or a data refresh does not move the camera, and a new
 * request for the same box does.
 */

import {
  FIT_PADDING_PX,
  framePadding,
  frameToken,
  shouldFrame,
  shouldRefit,
  type Rect,
} from '../../../web/connect/map/framing';
import { selectionBounds, type LineFeature, type MapActivity } from '../../../web/connect/map/view';

const map: Rect = { left: 0, top: 0, right: 1200, bottom: 800 };

describe('framePadding', () => {
  it('keeps the base padding when nothing is open over the map', () => {
    expect(framePadding(map, [])).toEqual({
      top: FIT_PADDING_PX,
      right: FIT_PADDING_PX,
      bottom: FIT_PADDING_PX,
      left: FIT_PADDING_PX,
    });
  });

  it('clears a tall panel on the left, a wide box on top and a bar along the bottom', () => {
    const panel: Rect = { left: 16, top: 16, right: 396, bottom: 780 };
    const layers: Rect = { left: 900, top: 16, right: 1184, bottom: 120 };
    const timeline: Rect = { left: 420, top: 730, right: 1184, bottom: 784 };
    const padding = framePadding(map, [panel, layers, timeline]);
    expect(padding.left).toBe(396 + FIT_PADDING_PX);
    expect(padding.top).toBe(120 + FIT_PADDING_PX);
    expect(padding.bottom).toBe(800 - 730 + FIT_PADDING_PX);
    expect(padding.right).toBe(FIT_PADDING_PX);
  });

  it('ignores an overlay that is closed or lies outside the map', () => {
    const closed: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    const away: Rect = { left: 2000, top: 0, right: 2400, bottom: 800 };
    expect(framePadding(map, [closed, away])).toEqual(framePadding(map, []));
  });

  it('leaves at least a third of each axis for the fitted box', () => {
    const wide: Rect = { left: 0, top: 0, right: 1100, bottom: 800 };
    const padding = framePadding(map, [wide, { left: 1100, top: 0, right: 1200, bottom: 800 }]);
    expect(1200 - padding.left - padding.right).toBeGreaterThanOrEqual(400);
    expect(800 - padding.top - padding.bottom).toBeGreaterThanOrEqual(800 / 3);
  });
});

describe('shouldFrame', () => {
  const box: [number, number, number, number] = [7, 46, 7.2, 46.2];

  it('frames a request once, whatever the athlete did to the camera since', () => {
    const token = frameToken({ bounds: box, seq: 1 });
    expect(shouldFrame(null, token)).toBe(true);
    expect(shouldFrame(token, frameToken({ bounds: [...box], seq: 1 }))).toBe(false);
  });

  it('frames the same box again when it is asked again', () => {
    const first = frameToken({ bounds: box, seq: 1 });
    expect(shouldFrame(first, frameToken({ bounds: box, seq: 2 }))).toBe(true);
  });

  it('frames nothing without bounds', () => {
    expect(shouldFrame(null, frameToken({}))).toBe(false);
  });

  it('falls back to the bounds themselves for a caller that sends no sequence', () => {
    const first = frameToken({ bounds: box });
    expect(shouldFrame(first, frameToken({ bounds: [...box] }))).toBe(false);
    expect(shouldFrame(first, frameToken({ bounds: [8, 46, 8.2, 46.2] }))).toBe(true);
  });
});

describe('selectionBounds', () => {
  const activity: MapActivity = {
    activityId: 'a1',
    bounds: { minLng: 7, minLat: 46, maxLng: 7.2, maxLat: 46.2 },
  };
  const line = (id: string): LineFeature => ({
    id,
    properties: { id },
    geometry: {
      type: 'LineString',
      coordinates: [
        [6, 45],
        [6.5, 45.5],
      ],
    },
  });

  it('is the bounds of the selected activity, route or section', () => {
    expect(selectionBounds('activity:a1', [activity], [], [])).toEqual([7, 46, 7.2, 46.2]);
    expect(selectionBounds('route:r1', [], [line('r1')], [])).toEqual([6, 45, 6.5, 45.5]);
    expect(selectionBounds('section:s1', [], [], [line('s1')])).toEqual([6, 45, 6.5, 45.5]);
  });

  it('is null until the selected item has loaded, and for a point or no selection', () => {
    expect(selectionBounds('activity:a1', [], [], [])).toBeNull();
    expect(selectionBounds('point:7,46', [activity], [], [])).toBeNull();
    expect(selectionBounds(null, [activity], [], [])).toBeNull();
  });
});

describe('shouldRefit', () => {
  const framed = { width: 900, height: 440 };

  it('refits when the container is a different size from the one last framed', () => {
    expect(shouldRefit(framed, { width: 1600, height: 440 })).toBe(true);
    expect(shouldRefit(framed, { width: 900, height: 700 })).toBe(true);
  });

  it('leaves the camera alone for the same size, and for a change under a pixel', () => {
    expect(shouldRefit(framed, { ...framed })).toBe(false);
    expect(shouldRefit(framed, { width: 900.4, height: 439.6 })).toBe(false);
  });

  it('does not refit a container with no area, which a hidden map has', () => {
    expect(shouldRefit(framed, { width: 0, height: 440 })).toBe(false);
    expect(shouldRefit(framed, { width: 900, height: 0 })).toBe(false);
  });

  it('refits when nothing has been framed at this size yet', () => {
    expect(shouldRefit(null, framed)).toBe(true);
  });
});
