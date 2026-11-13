/**
 * Scenario: the section detail map fits sections whose bounding box can be only
 * a couple of hundred metres across.
 *
 * Expected behaviour: the camera fits the supplied bounds and keeps room around
 * them for the controls, and the bounds padding scales with the section rather
 * than being a fixed number of degrees.
 */
import {
  SECTION_MAP_BOUNDS_PADDING,
  sectionCameraSpec,
} from '@/features/routes/lib/sectionMapCamera';
import { boundsOfLngLat } from '@/features/maps/lib/coordinates';

const SHORT_SECTION: [number, number][] = [
  [7.447, 46.948],
  [7.4485, 46.9492],
];

describe('section map camera', () => {
  it('fits bounds rather than pinning a centre and zoom', () => {
    const bounds = boundsOfLngLat(SHORT_SECTION, SECTION_MAP_BOUNDS_PADDING)!;

    const camera = sectionCameraSpec(bounds);

    // Pixels of room for the controls, not the fractional bounds padding.
    expect(camera.padding).toBe(80);
    expect(camera.center).toBeUndefined();
    expect(camera.zoom).toBeUndefined();
  });

  it('pads a short section by a fraction of its own extent', () => {
    const padded = boundsOfLngLat(SHORT_SECTION, SECTION_MAP_BOUNDS_PADDING)!;

    // 0.0015° x 0.0012° raw, so 15% padding is 0.000225° x 0.00018°.
    expect(padded.sw[0]).toBeCloseTo(7.446775, 9);
    expect(padded.sw[1]).toBeCloseTo(46.94782, 9);
    expect(padded.ne[0]).toBeCloseTo(7.448725, 9);
    expect(padded.ne[1]).toBeCloseTo(46.94938, 9);
  });
});
