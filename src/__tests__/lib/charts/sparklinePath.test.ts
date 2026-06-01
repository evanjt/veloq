import { line, curveMonotoneX } from 'd3-shape';
import { buildMonotoneSvg } from '@/lib/charts/sparklinePath';

// Locks pixel parity with Victory Native: Victory builds its line series the same
// way (d3-shape line + curveMonotoneX → SVG). If buildMonotoneSvg drifts from this
// construction, the direct-Skia sparkline would no longer match the Victory version.
describe('buildMonotoneSvg', () => {
  const values = [10, 25, 18, 40, 33, 50];
  const min = 10;
  const max = 50;
  const width = 100;
  const plotTop = 2;
  const plotHeight = 40;

  it('matches d3-shape line().curve(curveMonotoneX) with Victory scales', () => {
    const step = width / (values.length - 1);
    const range = max - min;
    const expected = line<number>()
      .x((_v, i) => i * step)
      .y((v) => plotTop + (1 - (v - min) / range) * plotHeight)
      .curve(curveMonotoneX)(values);
    expect(buildMonotoneSvg(values, min, max, width, plotTop, plotHeight)).toBe(expected);
  });

  it('maps the domain endpoints to the plot box (max→top, min→bottom)', () => {
    // First point value 10 (=min) → y = plotTop + plotHeight = 42; x = 0.
    const svg = buildMonotoneSvg(values, min, max, width, plotTop, plotHeight)!;
    expect(svg.startsWith('M0,42')).toBe(true);
    // Last x must be the full width.
    expect(svg).toContain('100,');
  });

  it('handles a flat series without dividing by zero', () => {
    const flat = [20, 20, 20];
    const svg = buildMonotoneSvg(flat, 20, 20, width, plotTop, plotHeight);
    expect(svg).not.toBeNull();
    expect(svg).not.toContain('NaN');
  });

  it.each([
    ['single point', [5], 0, 10, width],
    ['empty', [], 0, 10, width],
    ['zero width', [1, 2, 3], 1, 3, 0],
  ])('returns null for %s', (_label, vals, lo, hi, w) => {
    expect(
      buildMonotoneSvg(vals as number[], lo as number, hi as number, w as number, 2, 40)
    ).toBeNull();
  });
});
