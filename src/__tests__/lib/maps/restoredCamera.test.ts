/**
 * Scenario: a page rebuilt or remounted at the camera the athlete left holds a centre and zoom
 * only, so it has no track to refit and no frame to pad by.
 * Expected behaviour: the one function that chooses the reopening camera returns it padded, with the
 * subject bounds held apart from the camera and the camera pinned against the relief turn.
 */

import { pageOpensAt, restoredCamera } from '@/features/maps/lib/settledCamera';

const settled = { center: [7.66, 45.976] as [number, number], zoom: 13, bearing: 20, pitch: 0 };
const frame = {
  bounds: { sw: [7.65, 45.97] as [number, number], ne: [7.68, 45.98] as [number, number] },
  padding: { top: 60, right: 40, bottom: 320, left: 40 },
};

describe('restoredCamera', () => {
  it('keeps the athlete camera, pads it, holds the subject and pins it', () => {
    expect(restoredCamera(settled, frame)).toEqual({
      center: settled.center,
      zoom: 13,
      bearing: 20,
      pitch: 0,
      padding: frame.padding,
      padCamera: true,
      subjectBounds: frame.bounds,
      pinned: true,
    });
  });

  it('opens a page built at it, and not one built at another frame', () => {
    const built = restoredCamera(settled, frame);
    expect(pageOpensAt(built, settled, frame.padding)).toBe(true);
    expect(pageOpensAt(built, settled, { ...frame.padding, bottom: 100 })).toBe(false);
    expect(
      pageOpensAt(
        { center: settled.center, zoom: 13, bearing: 20, pitch: 0 },
        settled,
        frame.padding
      )
    ).toBe(false);
  });
});
