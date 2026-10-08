/**
 * Scenario: the memory reclaimer needs every mounted map, including the ones
 * behind a frozen tab that no render will reach.
 * Expected behaviour: a mounted surface is released once, rebuilt once on the
 * next foreground, and forgotten the moment it unmounts. A surface whose
 * screen is covered stays released through a foreground until it is shown.
 */
import {
  holdSurfaceReleased,
  markNativeReleasedSurface,
  registerReleasableSurface,
  releaseMountedSurfaces,
  rebuildReleasedSurfaces,
  resumeHeldSurface,
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

  it('rebuilds only the page that reported a native release', () => {
    const released = surface();
    const untouched = surface();
    const offReleased = registerReleasableSurface(released);
    const offUntouched = registerReleasableSurface(untouched);

    expect(markNativeReleasedSurface(released)).toBe(true);
    expect(markNativeReleasedSurface(released)).toBe(false);
    expect(rebuildReleasedSurfaces()).toBe(1);
    expect(released.release).toHaveBeenCalledWith('native');
    expect(released.rebuild).toHaveBeenCalledTimes(1);
    expect(untouched.release).not.toHaveBeenCalled();
    expect(untouched.rebuild).not.toHaveBeenCalled();
    offReleased();
    offUntouched();
  });

  it('ignores a native release report from an unmounted page', () => {
    const dropped = surface();
    const unregister = registerReleasableSurface(dropped);
    unregister();

    expect(markNativeReleasedSurface(dropped)).toBe(false);
    expect(rebuildReleasedSurfaces()).toBe(0);
    expect(dropped.release).not.toHaveBeenCalled();
  });

  it('releases a held surface alone and keeps it through a foreground', () => {
    const covered = surface();
    const shown = surface();
    const offCovered = registerReleasableSurface(covered);
    const offShown = registerReleasableSurface(shown);

    expect(holdSurfaceReleased(covered)).toBe(true);
    expect(covered.release).toHaveBeenCalledWith('javascript');
    expect(shown.release).not.toHaveBeenCalled();

    expect(rebuildReleasedSurfaces()).toBe(0);
    expect(covered.rebuild).not.toHaveBeenCalled();

    expect(resumeHeldSurface(covered)).toBe(true);
    expect(covered.rebuild).not.toHaveBeenCalled();
    expect(rebuildReleasedSurfaces()).toBe(0);
    offCovered();
    offShown();
  });

  it('neither releases a held surface twice nor rebuilds it on a trim cycle', () => {
    const covered = surface();
    const shown = surface();
    const offCovered = registerReleasableSurface(covered);
    const offShown = registerReleasableSurface(shown);

    holdSurfaceReleased(covered);
    expect(releaseMountedSurfaces()).toBe(1);
    expect(markNativeReleasedSurface(covered)).toBe(false);
    expect(covered.release).toHaveBeenCalledTimes(1);

    expect(rebuildReleasedSurfaces()).toBe(1);
    expect(shown.rebuild).toHaveBeenCalledTimes(1);
    expect(covered.rebuild).not.toHaveBeenCalled();

    expect(resumeHeldSurface(covered)).toBe(true);
    expect(resumeHeldSurface(covered)).toBe(false);
    offCovered();
    offShown();
  });

  it('holds a surface a trim already released without releasing it again', () => {
    const a = surface();
    const off = registerReleasableSurface(a);

    releaseMountedSurfaces();
    expect(holdSurfaceReleased(a)).toBe(false);
    expect(a.release).toHaveBeenCalledTimes(1);
    expect(rebuildReleasedSurfaces()).toBe(0);
    expect(resumeHeldSurface(a)).toBe(true);
    off();
  });

  it('has nothing to rebuild when the hold lifts on a page never released', () => {
    const a = surface();
    const off = registerReleasableSurface(a);

    expect(resumeHeldSurface(a)).toBe(false);
    off();
  });

  it('forgets a hold when the surface unmounts', () => {
    const a = surface();
    const off = registerReleasableSurface(a);

    holdSurfaceReleased(a);
    off();
    expect(resumeHeldSurface(a)).toBe(false);
    expect(holdSurfaceReleased(a)).toBe(false);
    expect(a.release).toHaveBeenCalledTimes(1);
  });
});
