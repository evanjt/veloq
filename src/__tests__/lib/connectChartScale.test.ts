/**
 * Scenario: the connect page's chart kit sizes its plot from the width it is
 * given, lays its tick labels out so none overlaps or leaves the drawing, puts
 * dates at their real time, stacks lanes on one x domain and reports a brushed
 * range as sample indexes.
 *
 * Expected behaviour: margins follow the widest measured label; at 320 and
 * 1600 px no two tick labels overlap and every one sits inside the drawing; a
 * date axis spaces points by days and ticks on calendar boundaries; every lane
 * of a stack has the same left, right and x position for a sample; a brush
 * names the samples inside it, and a click names none.
 */

import {
  TEXT_PX,
  brushDomain,
  calendarLayout,
  categoryTicks,
  chartMargins,
  drawingHeight,
  laneHeight,
  plotHeight,
  durationTicks,
  estimateWidth,
  fitText,
  histogramBins,
  indexAtPointer,
  indexRange,
  linearX,
  logTicks,
  nearestIndex,
  placeLabels,
  plotBox,
  stackLayout,
  timeTicks,
  trendBand,
  visibleIndexes,
  xAxisTicks,
  xOfIndex,
} from '../../../web/connect/charts/scale';

const DAY = 86_400_000;
const WIDTHS = [320, 1600];

const overlaps = (placed: { left: number; width: number }[], gap = 0) =>
  placed.some((a, i) =>
    placed
      .slice(i + 1)
      .some((b) => a.left < b.left + b.width + gap && b.left < a.left + a.width + gap)
  );

describe('margins from measured labels', () => {
  it('make room for the widest value label and no more', () => {
    const narrow = chartMargins({ yLabels: ['0', '5'], measure: estimateWidth });
    const wide = chartMargins({ yLabels: ['0', '1,250,000'], measure: estimateWidth });
    expect(wide.left).toBeGreaterThan(narrow.left);
    expect(wide.left).toBeGreaterThanOrEqual(estimateWidth('1,250,000'));
  });

  it('take a row for the x title and a row for the y title only when they are set', () => {
    const bare = chartMargins({ yLabels: ['1'], measure: estimateWidth });
    const titled = chartMargins({
      yLabels: ['1'],
      measure: estimateWidth,
      xTitle: true,
      yTitle: true,
    });
    expect(titled.bottom - bare.bottom).toBeGreaterThanOrEqual(TEXT_PX);
    expect(titled.top - bare.top).toBeGreaterThanOrEqual(TEXT_PX);
  });

  it('give a plot box whose edges are inside the drawing', () => {
    const box = plotBox(320, 200, chartMargins({ yLabels: ['10,000'], measure: estimateWidth }));
    expect(box.left).toBeGreaterThan(0);
    expect(box.right).toBeLessThan(320);
    expect(box.top).toBeLessThan(box.bottom);
  });
});

describe('text that must fit', () => {
  it('is cut with an ellipsis to the room it has and left alone when it fits', () => {
    expect(fitText('Power (W)', 500, estimateWidth)).toBe('Power (W)');
    const cut = fitText('Grade-adjusted pace (min/km)', 80, estimateWidth);
    expect(cut.endsWith('…')).toBe(true);
    expect(estimateWidth(cut)).toBeLessThanOrEqual(80);
  });
});

describe('tick labels', () => {
  it('never overlap and stay inside the drawing at 320 and 1600 px (distance axis)', () => {
    for (const width of WIDTHS) {
      const box = plotBox(width, 200, chartMargins({ yLabels: ['1,000'], measure: estimateWidth }));
      const ticks = xAxisTicks({
        kind: 'number',
        domain: [0, 42_195],
        box,
        format: (m) => `${(m / 1000).toFixed(1)} km`,
        measure: estimateWidth,
      });
      expect(ticks.length).toBeGreaterThan(1);
      expect(overlaps(ticks, 4)).toBe(false);
      for (const t of ticks) {
        expect(t.left).toBeGreaterThanOrEqual(0);
        expect(t.left + t.width).toBeLessThanOrEqual(width);
      }
    }
  });

  it('never overlap and stay inside the drawing at 320 and 1600 px (date axis)', () => {
    const domain: [number, number] = [Date.UTC(2024, 0, 3), Date.UTC(2026, 10, 14)];
    for (const width of WIDTHS) {
      const box = plotBox(width, 200, chartMargins({ yLabels: ['100'], measure: estimateWidth }));
      const ticks = xAxisTicks({
        kind: 'time',
        domain,
        box,
        format: String,
        measure: estimateWidth,
      });
      expect(ticks.length).toBeGreaterThan(0);
      expect(overlaps(ticks, 4)).toBe(false);
      for (const t of ticks) {
        expect(t.left).toBeGreaterThanOrEqual(0);
        expect(t.left + t.width).toBeLessThanOrEqual(width);
      }
    }
  });

  it('keep a label inside the box by shifting it, even one whose centre is on an edge', () => {
    const placed = placeLabels([0, 100], [30, 30], 0, 100, 4);
    expect(placed.map((p) => p.left)).toEqual([0, 70]);
  });

  it('thin out when they would collide and keep the first', () => {
    const placed = placeLabels([10, 20, 30, 40], [30, 30, 30, 30], 0, 200, 4);
    expect(placed.length).toBeLessThan(4);
    expect(placed[0]?.index).toBe(0);
    expect(overlaps(placed, 4)).toBe(false);
  });
});

describe('a date axis', () => {
  const jan1 = Date.UTC(2026, 0, 1);
  const feb1 = Date.UTC(2026, 1, 1);
  const mar1 = Date.UTC(2026, 2, 1);

  it('spaces points by the days between them, not by their order', () => {
    const x = linearX([jan1, mar1], 0, 590);
    // 31 days of 59 put February's first at 31/59 of the way, however many points lie between.
    expect(x.position(feb1)).toBeCloseTo((31 / 59) * 590);
    expect(x.position(jan1 + DAY) - x.position(jan1)).toBeCloseTo(10);
  });

  it('ticks on month starts for a span of some months', () => {
    const ticks = timeTicks([jan1, Date.UTC(2026, 6, 1)], 8, 'en-GB');
    expect(ticks.length).toBeGreaterThan(1);
    for (const tick of ticks) expect(new Date(tick.value).getUTCDate()).toBe(1);
    const gaps = ticks.slice(1).map((t, i) => t.value - (ticks[i]?.value ?? 0));
    expect(new Set(gaps).size).toBeGreaterThan(1); // calendar months are not equal in length
  });

  it('ticks on year starts for a span of years and on days for a span of days', () => {
    for (const tick of timeTicks([jan1, Date.UTC(2031, 0, 1)], 8, 'en-GB')) {
      expect(new Date(tick.value).getUTCMonth()).toBe(0);
    }
    const days = timeTicks([jan1, jan1 + 6 * DAY], 8, 'en-GB');
    for (const tick of days) expect((tick.value - jan1) % DAY).toBe(0);
  });
});

describe('category positions', () => {
  const box = plotBox(640, 240, { left: 48, right: 12, top: 10, bottom: 28 });

  it('puts the first and last line category on the plot edges', () => {
    expect(xOfIndex(0, 10, false, box)).toBe(box.left);
    expect(xOfIndex(9, 10, false, box)).toBe(box.right);
  });

  it('centres each banded category in an equal slot and names it from the same place', () => {
    for (const count of [1, 2, 10]) {
      for (let i = 0; i < count; i++) {
        for (const band of [false, true]) {
          expect(indexAtPointer(xOfIndex(i, count, band, box), count, band, box)).toBe(i);
        }
      }
    }
  });

  it('clamps a pointer past either edge and answers -1 for no categories', () => {
    expect(indexAtPointer(0, 10, false, box)).toBe(0);
    expect(indexAtPointer(10_000, 10, false, box)).toBe(9);
    expect(indexAtPointer(100, 0, false, box)).toBe(-1);
  });
});

describe('a stack of lanes', () => {
  it('shares one left, right and x position for a sample in every lane', () => {
    const margins = chartMargins({ yLabels: ['1,000'], measure: estimateWidth });
    const stack = stackLayout({ width: 700, lanes: 4, laneHeight: 90, margins });
    expect(stack.lanes).toHaveLength(4);
    const [first, ...rest] = stack.lanes;
    for (const lane of rest) {
      expect(lane.box.left).toBe(first?.box.left);
      expect(lane.box.right).toBe(first?.box.right);
    }
    const x = linearX([0, 3600], stack.lanes[0]!.box.left, stack.lanes[0]!.box.right);
    for (const lane of stack.lanes) {
      expect(linearX([0, 3600], lane.box.left, lane.box.right).position(1800)).toBe(
        x.position(1800)
      );
    }
  });

  it('stacks the lanes top to bottom without overlap and leaves room under the last for the axis', () => {
    const margins = chartMargins({ yLabels: ['1'], measure: estimateWidth });
    const stack = stackLayout({ width: 500, lanes: 3, laneHeight: 80, margins });
    for (let i = 1; i < stack.lanes.length; i++) {
      expect(stack.lanes[i]!.box.top).toBeGreaterThanOrEqual(stack.lanes[i - 1]!.box.bottom);
    }
    const last = stack.lanes[2]!;
    expect(stack.height).toBeGreaterThanOrEqual(last.box.bottom + TEXT_PX);
  });
});

describe('brushing', () => {
  const x = linearX([0, 1000], 50, 450);
  const xs = Array.from({ length: 11 }, (_, i) => i * 100);

  it('turns a drag into a domain and the samples inside it into an index range', () => {
    const domain = brushDomain(130, 250, x)!;
    expect(domain[0]).toBeCloseTo(200);
    expect(domain[1]).toBeCloseTo(500);
    expect(indexRange(xs, domain[0], domain[1])).toEqual({ from: 2, to: 5 });
  });

  it('reads a drag to the left as the same range', () => {
    expect(brushDomain(250, 130, x)).toEqual(brushDomain(130, 250, x));
  });

  it('clamps a drag past the plot to its edges', () => {
    expect(brushDomain(0, 9999, x)).toEqual([0, 1000]);
  });

  it('names nothing for a click, and no samples for a range between two samples', () => {
    expect(brushDomain(100, 102, x)).toBeNull();
    expect(indexRange(xs, 110, 190)).toBeNull();
  });

  it('keeps a sample that sits exactly on an edge of the range', () => {
    expect(indexRange(xs, 100, 100)).toEqual({ from: 1, to: 1 });
  });

  it('thins a long range evenly to a limit, keeping the ends', () => {
    const long = Array.from({ length: 10_000 }, (_, i) => i);
    const picked = visibleIndexes(long, 2_000, 4_000, 300);
    expect(picked.length).toBeLessThanOrEqual(301);
    expect(picked[0]).toBe(2_000);
    expect(picked[picked.length - 1]).toBe(4_000);
    expect(visibleIndexes(long, 5, 9, 300)).toEqual([5, 6, 7, 8, 9]);
  });
});

describe('nearest sample', () => {
  it('names the sample whose value is nearest, over unequal gaps', () => {
    const xs = [0, 10, 11, 500];
    expect(nearestIndex(xs, 4)).toBe(0);
    expect(nearestIndex(xs, 6)).toBe(1);
    expect(nearestIndex(xs, 200)).toBe(2);
    expect(nearestIndex(xs, 9999)).toBe(3);
    expect(nearestIndex([], 3)).toBe(-1);
  });
});

describe('histogram bins', () => {
  it('count every value once, in bins of equal width over the extent', () => {
    const bins = histogramBins([1, 2, 2, 3, 9, 10], 3);
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(6);
    expect(bins[0]!.low).toBeLessThanOrEqual(1);
    expect(bins[bins.length - 1]!.high).toBeGreaterThanOrEqual(10);
    const widths = new Set(bins.map((b) => Math.round((b.high - b.low) * 1e6)));
    expect(widths.size).toBe(1);
  });

  it('puts a value on a bin edge in the upper bin, except the last value', () => {
    const bins = histogramBins([0, 5, 10], 2);
    expect(bins.map((b) => b.count)).toEqual([1, 2]);
  });

  it('ignores gaps and answers no bins for no values', () => {
    expect(histogramBins([NaN, Infinity], 4)).toEqual([]);
    expect(histogramBins([], 4)).toEqual([]);
  });
});

describe('a trend band', () => {
  it('fits the line through collinear points with a zero-width band', () => {
    const band = trendBand([0, 1, 2, 3], [1, 3, 5, 7])!;
    expect(band.slope).toBeCloseTo(2);
    expect(band.intercept).toBeCloseTo(1);
    expect(band.spread).toBeCloseTo(0);
  });

  it('widens the band with the scatter about the line', () => {
    const tight = trendBand([0, 1, 2, 3, 4], [0, 1.1, 1.9, 3.1, 4])!;
    const loose = trendBand([0, 1, 2, 3, 4], [0, 3, 1, 4, 2])!;
    expect(loose.spread).toBeGreaterThan(tight.spread);
  });

  it('needs two distinct x values', () => {
    expect(trendBand([1], [1])).toBeNull();
    expect(trendBand([2, 2, 2], [1, 2, 3])).toBeNull();
  });
});

describe('a curve axis', () => {
  it('ticks a duration axis on round times from one second to the longest', () => {
    const ticks = logTicks([1, 7_200]);
    expect(ticks).toEqual(expect.arrayContaining([1, 60, 300, 3_600]));
    expect(ticks.every((t) => t >= 1 && t <= 7_200)).toBe(true);
  });
});

describe('a calendar', () => {
  it('lays days in week columns with Monday on the top row and one cell per day', () => {
    // 2026-11-14 is a Saturday.
    const cells = calendarLayout(['2026-11-09', '2026-11-14', '2026-11-16']);
    const byDate = Object.fromEntries(cells.map((c) => [c.date, c]));
    expect(byDate['2026-11-09']!.row).toBe(0);
    expect(byDate['2026-11-14']!.row).toBe(5);
    expect(byDate['2026-11-14']!.column).toBe(byDate['2026-11-09']!.column);
    expect(byDate['2026-11-16']!.column).toBe(byDate['2026-11-09']!.column + 1);
    expect(cells).toHaveLength(3);
  });
});

describe('category tick labels', () => {
  it.each(WIDTHS)('never overlap and stay inside a drawing %i px wide', (width) => {
    const dates = Array.from(
      { length: 90 },
      (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`
    );
    const box = plotBox(width, 200, chartMargins({ yLabels: ['1,000'], measure: estimateWidth }));
    const centres = dates.map((_, i) => xOfIndex(i, dates.length, true, box));
    const placed = categoryTicks(dates, centres, width, estimateWidth);
    expect(placed.length).toBeGreaterThan(1);
    expect(overlaps(placed, 4)).toBe(false);
    for (const t of placed) {
      expect(t.left).toBeGreaterThanOrEqual(0);
      expect(t.left + t.width).toBeLessThanOrEqual(width);
    }
  });
});

describe('a ride-time axis', () => {
  it('ticks on whole minutes or hours rather than on round seconds', () => {
    for (const tick of durationTicks([0, 5_400], 6)) expect(tick % 60).toBe(0);
    expect(durationTicks([0, 5_400], 6).length).toBeLessThanOrEqual(6);
  });

  it.each(WIDTHS)('lays out labels that fit a drawing %i px wide', (width) => {
    const box = plotBox(width, 200, chartMargins({ yLabels: ['100'], measure: estimateWidth }));
    const ticks = xAxisTicks({
      kind: 'duration',
      domain: [0, 12_600],
      box,
      format: (s) =>
        `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`,
      measure: estimateWidth,
      width,
    });
    expect(ticks.length).toBeGreaterThan(1);
    expect(overlaps(ticks, 4)).toBe(false);
    for (const t of ticks) expect(t.left + t.width).toBeLessThanOrEqual(width);
  });
});

describe('plot heights derived from width', () => {
  const plotWidths = [800, 1400, 2400, 2560];

  it('keeps a single chart no flatter than 6:1 and within 240 to 320 px while the ratio allows', () => {
    for (const width of plotWidths) {
      const h = plotHeight(width);
      expect(width / h).toBeLessThanOrEqual(6);
      expect(h).toBeGreaterThanOrEqual(240);
      if (width <= 1920) expect(h).toBeLessThanOrEqual(320);
    }
  });

  it('keeps a lane no flatter than 10:1 and within 72 to 140 px while the ratio allows', () => {
    for (const width of plotWidths) {
      const h = laneHeight(width);
      expect(width / h).toBeLessThanOrEqual(10);
      expect(h).toBeGreaterThanOrEqual(72);
      if (width <= 1400) expect(h).toBeLessThanOrEqual(140);
    }
  });

  it('floors both at their minimum on a narrow card', () => {
    expect(plotHeight(200)).toBe(240);
    expect(laneHeight(200)).toBe(72);
  });

  it('adds the margins to a derived plot and takes an explicit height as the drawing height', () => {
    const margins = { left: 40, right: 12, top: 8, bottom: 22 };
    const derived = drawingHeight(1400, margins);
    expect(derived).toBe(plotHeight(1400 - 52) + 30);
    expect(drawingHeight(1400, margins, 180)).toBe(180);
  });
});
