/**
 * Scenario: a worker page is given each basemap style once and holds it for
 * as long as it lives, and every render after that is only the request. A
 * render splices its terrain, hillshade and route into the style it mounts.
 *
 * Expected behaviour: each full render mounts the whole held style, a 3D
 * render's terrain never reaches a later flat render through the held copy,
 * and a page asked to draw a style it does not hold says so rather than
 * drawing nothing.
 */

import { bootWorkerPage } from '../../__shared__/snapshotWorkerPage';
import { resolveStyleForWebView } from '@/features/maps/lib/htmlBuilders/styleResolution';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const request = (flat: boolean, activityId = 'ride-1'): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: flat ? 0 : 60, bearing: 0 },
  mapStyle: 'light',
  routeColor: '#ff0000',
  flat,
});

interface MountedStyle {
  sources: Record<string, unknown>;
  layers: { id: string }[];
}

const lightLayerIds = () =>
  (resolveStyleForWebView('light').inline as MountedStyle).layers.map((layer) => layer.id);

describe('a worker page drawing from the styles it holds', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('mounts the whole held style on every full render after the first', () => {
    const page = bootWorkerPage();

    page.render(request(true, 'a0'), 1);
    jest.advanceTimersByTime(1000);
    page.render(request(false, 'a1'), 2);
    jest.advanceTimersByTime(1000);

    const mounted = page.map.setStyle.mock.calls.map((call) => call[0] as MountedStyle);
    expect(mounted).toHaveLength(2);
    expect(page.posted.filter((m) => m.type === 'snapshot').map((m) => m.activityId)).toContain(
      'a0'
    );
    const ids = mounted[1].layers.map((layer) => layer.id);
    expect(ids).toEqual(expect.arrayContaining(lightLayerIds()));
    expect(ids).toContain('hillshading');
    expect(mounted[1].sources).toHaveProperty('terrain');
  });

  it('keeps one render from carrying its terrain into the next through the held style', () => {
    const page = bootWorkerPage();

    page.render(request(false, 'a0'), 1);
    jest.advanceTimersByTime(1000);
    page.render(request(true, 'a1'), 2);
    jest.advanceTimersByTime(1000);

    const flat = page.map.setStyle.mock.calls[1][0] as MountedStyle;
    expect(flat.sources).not.toHaveProperty('terrain');
    expect(flat.layers.map((layer) => layer.id)).not.toContain('hillshading');
    expect(flat.layers.filter((layer) => layer.id === 'route-line')).toHaveLength(1);
  });

  it('asks for a style it does not hold rather than drawing without one', () => {
    const before = bootWorkerPage();
    before.render(request(true, 'a0'), 1);
    // The page reloaded and the host still believes it holds the style.
    const page = bootWorkerPage();
    for (const [name, json] of before.held) page.held.set(name, json);

    page.render(request(true, 'a1'), 1);

    expect(page.map.setStyle).not.toHaveBeenCalled();
    expect(page.posted).toEqual([
      expect.objectContaining({
        type: 'snapshotError',
        activityId: 'a1',
        gen: 1,
        styleMissing: true,
      }),
    ]);
  });
});
