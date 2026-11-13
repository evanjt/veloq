import { area, curveLinear, curveMonotoneX, curveNatural, line } from 'd3-shape';

import { curveAreaSvg, curveLineSvg } from '@/shared/charts/curvePath';

const pts = [
  { x: 0, y: 40 },
  { x: 25, y: 10 },
  { x: 50, y: 30 },
  { x: 75, y: 5 },
  { x: 100, y: 20 },
];

describe('curveLineSvg', () => {
  it('matches d3 curveNatural through the same pixels', () => {
    const expected = line<{ x: number; y: number }>()
      .x((p) => p.x)
      .y((p) => p.y)
      .curve(curveNatural)(pts);
    expect(curveLineSvg(pts)).toBe(expected);
  });

  it.each([
    ['monotone', curveMonotoneX],
    ['linear', curveLinear],
  ] as const)('matches d3 for the %s curve', (kind, curve) => {
    const expected = line<{ x: number; y: number }>()
      .x((p) => p.x)
      .y((p) => p.y)
      .curve(curve)(pts);
    expect(curveLineSvg(pts, kind)).toBe(expected);
  });

  it('starts at the first pixel and contains no NaN', () => {
    const svg = curveLineSvg(pts) ?? '';
    expect(svg.startsWith('M0,40')).toBe(true);
    expect(svg).not.toContain('NaN');
  });

  it('draws nothing from fewer than two points', () => {
    expect(curveLineSvg([])).toBeNull();
    expect(curveLineSvg([{ x: 1, y: 1 }])).toBeNull();
  });
});

describe('curveAreaSvg', () => {
  it('matches d3 area closed to the baseline', () => {
    const expected = area<{ x: number; y: number }>()
      .x((p) => p.x)
      .y0(() => 100)
      .y1((p) => p.y)
      .curve(curveNatural)(pts);
    expect(curveAreaSvg(pts, 100)).toBe(expected);
  });

  it('returns to the baseline and closes', () => {
    const svg = curveAreaSvg(pts, 100) ?? '';
    expect(svg).toContain('L100,100');
    expect(svg.endsWith('Z')).toBe(true);
  });

  it('draws nothing from fewer than two points', () => {
    expect(curveAreaSvg([{ x: 1, y: 1 }], 100)).toBeNull();
  });
});
