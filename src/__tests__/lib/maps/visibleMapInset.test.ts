/**
 * Scenario: the hero's name and stats, the control column and the header each cover part of a map.
 * Expected behaviour: a fitted track lands in the part left visible, and the 2D page and the 3D
 * page frame it with the same per-edge padding.
 */
import { TRACK_FIT_PADDING, visibleMapInset } from '@/features/maps/lib/activityCamera';
import { buildMap3DHtml, buildSetRouteScript } from '@/features/maps/lib/htmlBuilders';
import { buildFitBoundsScript } from '@/features/maps/lib/htmlBuilders/mapSurface';

const bounds = { sw: [7.2, 46.1] as [number, number], ne: [7.4, 46.3] as [number, number] };

describe('visibleMapInset', () => {
  it('keeps the track above what covers the bottom, and not under the column', () => {
    const inset = visibleMapInset({
      width: 400,
      height: 600,
      coveredBottom: 200,
      coveredRight: 56,
    });

    expect(inset.bottom).toBeGreaterThanOrEqual(200);
    expect(inset.top).toBeLessThan(200);
    expect(inset.right).toBeGreaterThanOrEqual(56);
    expect(inset.left).toBe(TRACK_FIT_PADDING);
  });

  it('is the plain margin on every edge when nothing covers the map', () => {
    expect(visibleMapInset({ width: 400, height: 600 })).toEqual({
      top: TRACK_FIT_PADDING,
      right: TRACK_FIT_PADDING,
      bottom: TRACK_FIT_PADDING,
      left: TRACK_FIT_PADDING,
    });
  });

  it('takes a margin other than the track default', () => {
    const inset = visibleMapInset({ width: 400, height: 600, coveredTop: 90, margin: 80 });

    expect(inset.top).toBeGreaterThanOrEqual(90);
    expect(inset.left).toBe(80);
  });

  it('leaves room to draw when the covers would take the whole map', () => {
    const inset = visibleMapInset({
      width: 300,
      height: 240,
      coveredTop: 100,
      coveredBottom: 200,
      coveredRight: 280,
    });

    expect(240 - inset.top - inset.bottom).toBeGreaterThan(0);
    expect(300 - inset.left - inset.right).toBeGreaterThan(0);
    expect(inset.bottom).toBeGreaterThan(inset.top);
  });

  it('never returns a negative edge for a map that has not been measured', () => {
    const inset = visibleMapInset({ width: 0, height: 0, coveredBottom: 120 });

    for (const edge of Object.values(inset)) expect(edge).toBeGreaterThanOrEqual(0);
  });
});

describe('the 2D and 3D fits for one cover', () => {
  const inset = visibleMapInset({ width: 400, height: 600, coveredBottom: 200, coveredRight: 56 });
  const literal = JSON.stringify(inset);

  it('carry the same per-edge padding', () => {
    expect(buildFitBoundsScript(bounds, inset)).toContain(`padding: ${literal}`);
    expect(buildSetRouteScript([[7.3, 46.2]], bounds, undefined, inset)).toContain(
      `padding: ${literal},`
    );
    expect(
      buildMap3DHtml({
        coordinates: [[7.3, 46.2]],
        bounds,
        fitPadding: inset,
        initStyle: 'light',
        mapStyle: 'light',
      } as never)
    ).toContain(`opts.fitBoundsOptions = { padding: ${literal} };`);
  });
});
