/**
 * Scenario: the section detail map fits sections whose bounding box can be only
 * a couple of hundred metres across.
 *
 * Expected behaviour: the camera fits the supplied bounds, keeps room around
 * them for the controls, and clamps zoom at street level so a short section
 * does not push past the point where basemap tiles turn grainy.
 */
import {
  SECTION_MAP_BOUNDS_PADDING,
  SECTION_MAP_FIT_PADDING,
  SECTION_MAP_MAX_ZOOM,
  sectionCameraSpec,
} from '@/features/routes/lib/sectionMapCamera';
import { boundsOfLngLat } from '@/features/maps/lib/coordinates';

const SHORT_SECTION: [number, number][] = [
  [7.447, 46.948],
  [7.4485, 46.9492],
];

describe('section map camera', () => {
  it('clamps zoom at street level', () => {
    expect(SECTION_MAP_MAX_ZOOM).toBeLessThanOrEqual(16);
  });

  it('fits the supplied bounds with room for the controls', () => {
    const bounds = boundsOfLngLat(SHORT_SECTION, SECTION_MAP_BOUNDS_PADDING);
    expect(bounds).not.toBeNull();

    const camera = sectionCameraSpec(bounds!);

    expect(camera.bounds).toEqual(bounds);
    expect(camera.padding).toBe(SECTION_MAP_FIT_PADDING);
    expect(camera.center).toBeUndefined();
    expect(camera.zoom).toBeUndefined();
  });

  it('pads a short section beyond its raw extent', () => {
    const raw = boundsOfLngLat(SHORT_SECTION)!;
    const padded = boundsOfLngLat(SHORT_SECTION, SECTION_MAP_BOUNDS_PADDING)!;

    expect(padded.sw[0]).toBeLessThan(raw.sw[0]);
    expect(padded.sw[1]).toBeLessThan(raw.sw[1]);
    expect(padded.ne[0]).toBeGreaterThan(raw.ne[0]);
    expect(padded.ne[1]).toBeGreaterThan(raw.ne[1]);
  });
});
