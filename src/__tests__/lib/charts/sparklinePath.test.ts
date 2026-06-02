import { line, area, curveMonotoneX } from 'd3-shape';
import { buildMonotoneSvg, buildMonotoneAreaSvg } from '@/lib/charts/sparklinePath';

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

// Locks pixel parity with Victory Native's <Area curveType="monotoneX" y0={baseline}>,
// which builds the fill the same way (d3-shape area + curveMonotoneX → SVG).
describe('buildMonotoneAreaSvg', () => {
  const values = [10, 25, 18, 40, 33, 50];
  const min = 10;
  const max = 50;
  const width = 100;
  const plotTop = 2;
  const plotHeight = 40;
  const baseline = 48;

  it('matches d3-shape area().curve(curveMonotoneX) with Victory scales', () => {
    const step = width / (values.length - 1);
    const range = max - min;
    const y = (v: number) => plotTop + (1 - (v - min) / range) * plotHeight;
    const expected = area<number>()
      .x((_v, i) => i * step)
      .y0(() => y(baseline))
      .y1((v) => y(v))
      .curve(curveMonotoneX)(values);
    expect(buildMonotoneAreaSvg(values, min, max, width, plotTop, plotHeight, baseline)).toBe(
      expected
    );
  });

  it('produces a closed fill path (ends with Z)', () => {
    const svg = buildMonotoneAreaSvg(values, min, max, width, plotTop, plotHeight, baseline)!;
    expect(svg.trim().endsWith('Z')).toBe(true);
    expect(svg).not.toContain('NaN');
  });

  it.each([
    ['single point', [5]],
    ['empty', []],
  ])('returns null for %s', (_label, vals) => {
    expect(buildMonotoneAreaSvg(vals as number[], 0, 10, width, plotTop, plotHeight, 5)).toBeNull();
  });
});
