import { polylineSvgPath, bandSvgPath } from '@/shared/charts/svgPath';

// These builders feed Skia.Path.MakeFromSVGString — the supported constructor after
// the imperative Skia.Path.Make().moveTo()/lineTo() API was deprecated in skia 2.x.
// Skia is native (unavailable in jest), so we assert the "d" string they produce.

describe('polylineSvgPath', () => {
  it('returns an empty string for no points', () => {
    expect(polylineSvgPath([])).toBe('');
  });

  it('emits a lone moveTo for a single point', () => {
    expect(polylineSvgPath([{ x: 1, y: 2 }])).toBe('M1 2');
  });

  it('moves to the first point then lines to the rest', () => {
    expect(
      polylineSvgPath([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 3 },
      ])
    ).toBe('M0 0L1 1L2 3');
  });

  it('preserves fractional pixel coordinates', () => {
    expect(
      polylineSvgPath([
        { x: 0.5, y: 1.25 },
        { x: 10.75, y: 2.5 },
      ])
    ).toBe('M0.5 1.25L10.75 2.5');
  });
});

describe('bandSvgPath', () => {
  it('returns an empty string when either edge is empty', () => {
    expect(bandSvgPath([], [{ x: 0, y: 1 }])).toBe('');
    expect(bandSvgPath([{ x: 0, y: 1 }], [])).toBe('');
  });

  it('traces the upper edge forward, the lower edge backward, then closes', () => {
    const upper = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ];
    const lower = [
      { x: 0, y: 4 },
      { x: 2, y: 4 },
    ];
    expect(bandSvgPath(upper, lower)).toBe('M0 0L2 0L2 4L0 4Z');
  });
});
