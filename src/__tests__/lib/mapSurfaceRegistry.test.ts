/**
 * Scenario: the memory reclaimer needs every mounted map, including the ones
 * behind a frozen tab that no render will reach.
 * Expected behaviour: a mounted surface is released once, rebuilt once on the
 * next foreground, and forgotten the moment it unmounts.
 */
import {
  registerReleasableSurface,
  releaseMountedSurfaces,
  rebuildReleasedSurfaces,
} from '@/features/maps/lib/mapSurfaceRegistry';

function surface() {
  return { release: jest.fn(), rebuild: jest.fn() };
}

describe('map surface registry', () => {
  it('releases every mounted surface and rebuilds only those', () => {
    const a = surface();
    const b = surface();
    const offA = registerReleasableSurface(a);
    const offB = registerReleasableSurface(b);

    expect(releaseMountedSurfaces()).toBe(2);
    expect(a.release).toHaveBeenCalledTimes(1);
    expect(b.release).toHaveBeenCalledTimes(1);

    expect(rebuildReleasedSurfaces()).toBe(2);
    expect(a.rebuild).toHaveBeenCalledTimes(1);
    expect(b.rebuild).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it('does not release a surface twice across two trim levels', () => {
    const a = surface();
    const off = registerReleasableSurface(a);

    releaseMountedSurfaces();
    expect(releaseMountedSurfaces()).toBe(0);
    expect(a.release).toHaveBeenCalledTimes(1);
    off();
  });

  it('rebuilds nothing when nothing was released', () => {
    const a = surface();
    const off = registerReleasableSurface(a);

    expect(rebuildReleasedSurfaces()).toBe(0);
    expect(a.rebuild).not.toHaveBeenCalled();
    off();
  });

  it('releases again after a rebuild', () => {
    const a = surface();
    const off = registerReleasableSurface(a);

    releaseMountedSurfaces();
    rebuildReleasedSurfaces();
    expect(releaseMountedSurfaces()).toBe(1);
    expect(a.release).toHaveBeenCalledTimes(2);
    off();
  });

  it('forgets a surface that unmounted while released', () => {
    const a = surface();
    const off = registerReleasableSurface(a);

    releaseMountedSurfaces();
    off();
    expect(rebuildReleasedSurfaces()).toBe(0);
    expect(a.rebuild).not.toHaveBeenCalled();
  });

  it('keeps going when one surface throws', () => {
    const broken = {
      release: jest.fn(() => {
        throw new Error('page gone');
      }),
      rebuild: jest.fn(),
    };
    const fine = surface();
    const offBroken = registerReleasableSurface(broken);
    const offFine = registerReleasableSurface(fine);

    expect(releaseMountedSurfaces()).toBe(1);
    expect(fine.release).toHaveBeenCalledTimes(1);
    offBroken();
    offFine();
  });
});
