import {
  cameraPadding,
  fitZoom,
  openingCamera,
  paddedFit,
  settleCameraAction,
} from '@/features/maps/lib/cameraPadding';
import { sectionCameraSpec } from '@/features/routes/lib/sectionMapCamera';
import { ROUTE_MAP_FIT_PADDING, routeCameraSpec } from '@/features/routes/lib/routeMapCamera';
import { buildMap3DHtml } from '@/features/maps/lib/htmlBuilders';

const bounds = { sw: [6.9, 46.2] as [number, number], ne: [7.0, 46.25] as [number, number] };
const page = { width: 400, height: 600 };

describe('cameraPadding', () => {
  const covered = cameraPadding({ ...page, coveredBottom: 300 });

  it('pads the camera by the part the sheet covers', () => {
    expect(covered.bottom).toBeGreaterThanOrEqual(300);
  });

  it('gives the flat and the 3D surface the same padding for one input', () => {
    const input = { ...page, coveredTop: 60, coveredBottom: 300, coveredRight: 48 };
    expect(cameraPadding(input)).toEqual(cameraPadding({ ...input }));
  });

  describe('opening camera', () => {
    const saved = { center: [6.95, 46.225] as [number, number], zoom: 13, bearing: 20, pitch: 60 };

    it('carries the inset and keeps bearing and pitch', () => {
      const { camera } = openingCamera(saved, covered, { bounds, ...page });
      expect(camera.padding).toEqual(covered);
      expect(camera.bearing).toBe(20);
      expect(camera.pitch).toBe(60);
      expect(camera.center).toEqual(saved.center);
    });

    it('refits when the zoom no longer holds the track in the visible frame', () => {
      const full = fitZoom(bounds, page, cameraPadding(page), 20);
      const tight = fitZoom(bounds, page, covered, 20);
      expect(tight).toBeLessThan(full);
      const atFull = { ...saved, zoom: (full + tight) / 2 + 0.001 };
      expect(openingCamera(atFull, covered, { bounds, ...page }).refit).toBe(true);
    });

    it('keeps the zoom when the track already fits the visible frame', () => {
      const fits = { ...saved, zoom: fitZoom(bounds, page, covered, 20) - 0.5 };
      expect(openingCamera(fits, covered, { bounds, ...page }).refit).toBe(false);
    });

    it('does not refit with no bounds', () => {
      expect(openingCamera(saved, covered, { bounds: null, ...page }).refit).toBe(false);
    });
  });

  describe('sheet settle', () => {
    const peek = cameraPadding({ ...page, coveredBottom: 60 });

    it('refits an unmoved map to the new inset', () => {
      expect(settleCameraAction({ previous: covered, next: peek, athleteMoved: false })).toEqual({
        kind: 'refit',
        padding: peek,
      });
    });

    it('eases a moved map so its centre stays at the visible centre', () => {
      expect(settleCameraAction({ previous: covered, next: peek, athleteMoved: true })).toEqual({
        kind: 'ease',
        padding: peek,
      });
    });

    it('does nothing when the inset is unchanged, as above Half', () => {
      expect(
        settleCameraAction({ previous: covered, next: { ...covered }, athleteMoved: false })
      ).toEqual({ kind: 'none' });
      expect(
        settleCameraAction({ previous: covered, next: { ...covered }, athleteMoved: true })
      ).toEqual({ kind: 'none' });
    });
  });
});

describe('3D page camera padding', () => {
  it('defines the inset helpers the camera moves go through', () => {
    const html = buildMap3DHtml({ initStyle: 'light', mapStyle: 'light' } as never);
    expect(html).toContain('_veloqSetInset');
    expect(html).toContain('_veloqFitInset');
  });
});

describe('detail map cameras', () => {
  const inset = cameraPadding({ ...page, coveredTop: 60, coveredBottom: 300 });

  it('pads the section map camera to the visible part, as the activity map does', () => {
    expect(sectionCameraSpec(bounds, inset)).toEqual(paddedFit(bounds, inset));
    expect(paddedFit(bounds, inset)).toEqual({ bounds, padding: inset, padCamera: true });
  });

  it('pads the route map camera to the visible part, as the activity map does', () => {
    expect(routeCameraSpec(bounds, inset)).toEqual(paddedFit(bounds, inset));
  });

  it('keeps a plain margin and no padded camera when no inset is given', () => {
    expect(sectionCameraSpec(bounds).padCamera).toBeUndefined();
    expect(routeCameraSpec(bounds, undefined)).toEqual({ bounds, padding: ROUTE_MAP_FIT_PADDING });
  });
});
