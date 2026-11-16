/**
 * Scenario: the chart kit measures tick labels with a canvas, which has
 * proportional digits, while the svg draws tabular ones; and a font family the
 * canvas cannot parse leaves it on its 10 px default.
 *
 * Expected behaviour: a digit is measured at the widest digit's width, a
 * family the canvas rejects gives no measure so the caller falls back to the
 * estimate, and a time axis laid out with that measure has no two labels
 * meeting and none past the drawing.
 */

import { TEXT_PX, chartMargins, plotBox, xAxisTicks } from '../../../web/connect/charts/scale';
import { canvasMeasure } from '../../../web/connect/charts/useSize';

const DIGIT_WIDTHS: Record<string, number> = { '1': 4, '0': 7, '2': 7, '5': 7, '6': 7, '9': 7 };

function fakeCanvas(accepts: (font: string) => boolean) {
  let font = '10px sans-serif';
  return {
    get font() {
      return font;
    },
    set font(value: string) {
      if (accepts(value)) font = value;
    },
    measureText: (text: string) => ({
      width: [...text].reduce((sum, c) => sum + (c === '-' ? 4 : (DIGIT_WIDTHS[c] ?? 7)), 0),
    }),
  };
}

describe('the canvas measure', () => {
  it('measures every digit at the widest digit, as tabular figures are drawn', () => {
    const measure = canvasMeasure(
      fakeCanvas(() => true),
      'Inter, sans-serif'
    );
    expect(measure?.('1111')).toBe(28);
    expect(measure?.('2025-11-09')).toBe(8 * 7 + 2 * 4);
  });

  it('gives none when the canvas keeps its default font', () => {
    expect(
      canvasMeasure(
        fakeCanvas(() => false),
        'not a family'
      )
    ).toBeNull();
  });

  it('leaves a gap between date labels and keeps the last one inside the drawing at 1280 px', () => {
    const measure = canvasMeasure(
      fakeCanvas(() => true),
      'Inter'
    )!;
    const width = 1280;
    const box = plotBox(width, 200, chartMargins({ yLabels: ['100'], measure }));
    const ticks = xAxisTicks({
      kind: 'time',
      domain: [Date.UTC(2025, 10, 9), Date.UTC(2026, 10, 9)],
      box,
      measure,
      width,
      locale: 'sv-SE',
    });
    expect(ticks.length).toBeGreaterThan(1);
    ticks.forEach((t, i) => {
      const next = ticks[i + 1];
      if (next) expect(t.left + t.width).toBeLessThan(next.left);
      expect(t.left + t.width).toBeLessThanOrEqual(width);
    });
    expect(TEXT_PX).toBe(12);
  });
});
