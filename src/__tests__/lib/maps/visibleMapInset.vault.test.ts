/**
 * Scenario: the hero's name and stats, the control column and the header each cover part of a map.
 * Expected behaviour: a fitted track lands in the part left visible, and the fit script carries
 * that per-edge padding.
 */
import { TRACK_FIT_PADDING, visibleMapInset } from '@/features/maps/lib/activityCamera';
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

  it('keeps the track beside a panel docked on the left', () => {
    const inset = visibleMapInset({ width: 1024, height: 1366, coveredLeft: 400 });

    expect(inset.left).toBe(400 + TRACK_FIT_PADDING);
    expect(inset.right).toBe(TRACK_FIT_PADDING);
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

describe('the fit script for one cover', () => {
  it('carries the per-edge padding', () => {
    const inset = visibleMapInset({
      width: 400,
      height: 600,
      coveredBottom: 200,
      coveredRight: 56,
    });

    expect(buildFitBoundsScript(bounds, inset)).toContain(`padding: ${JSON.stringify(inset)}`);
  });
});
