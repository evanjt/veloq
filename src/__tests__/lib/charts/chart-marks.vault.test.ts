/**
 * Expected behaviour: every chart draws one mark set. A line is 2px, a dot is
 * 8px across with a 2px surface ring, a bar is at most 24px wide with 4px
 * rounded ends and a 2px gap, and the reticle and record marks sit clear of
 * the dot they surround.
 */

import {
  BAR_GAP,
  BAR_MAX_WIDTH,
  RECORD_RING_RADIUS,
  RETICLE_INNER,
  barRadiusFor,
  barWidthFor,
  chartStroke,
  dotDisks,
  groupedBarCentre,
  groupedBarWidth,
  reticleTicks,
  staircasePoints,
  triangleSvg,
} from '@/shared/charts/chartMarks';

describe('chart strokes', () => {
  it('draws a series at 2px and a reference, grid, axis and scrub line at 1px', () => {
    expect(chartStroke.series).toBe(2);
    expect(chartStroke.reference).toBe(1);
    expect(chartStroke.grid).toBe(1);
    expect(chartStroke.axis).toBe(1);
    expect(chartStroke.crosshair).toBe(1);
  });
});

describe('dotDisks', () => {
  it('is an 8px dot inside a 2px surface ring', () => {
    expect(dotDisks()).toEqual({ fill: 4, ring: 6 });
  });
});

describe('barWidthFor', () => {
  it('caps a sparse series at 24px', () => {
    expect(barWidthFor([20, 180, 340], 360)).toBe(BAR_MAX_WIDTH);
  });

  it('caps a single bar, whose only gap is the plot width', () => {
    expect(barWidthFor([180], 360)).toBe(BAR_MAX_WIDTH);
  });

  it('leaves a 2px gap between dense bars', () => {
    expect(barWidthFor([0, 10, 20, 30], 360)).toBe(10 - BAR_GAP);
  });

  it('cuts every bar from the narrowest gap', () => {
    expect(barWidthFor([0, 40, 46, 120], 360)).toBe(6 - BAR_GAP);
  });

  it('never draws a bar narrower than a pixel', () => {
    expect(barWidthFor([0, 1, 2], 360)).toBe(1);
  });
});

describe('groupedBarWidth', () => {
  it('caps each bar of a wide slot at 24px', () => {
    expect(groupedBarWidth(120, 2)).toBe(BAR_MAX_WIDTH);
  });

  it('shares a narrow slot between its bars with a 2px gap between them and the next slot', () => {
    // 30px slot, one gap to the next slot and one between the pair: (30 - 2 - 2) / 2.
    expect(groupedBarWidth(30, 2)).toBe(13);
  });

  it('places a group centred on its slot with a 2px gap between neighbours', () => {
    const left = groupedBarCentre(100, 13, 2, 0);
    const right = groupedBarCentre(100, 13, 2, 1);
    expect(right - left).toBe(13 + BAR_GAP);
    expect((left + right) / 2).toBe(100);
  });
});

describe('barRadiusFor', () => {
  it('rounds the ends at 4px', () => {
    expect(barRadiusFor(24)).toBe(4);
  });

  it('halves a bar too narrow for the full radius', () => {
    expect(barRadiusFor(6)).toBe(3);
  });
});

describe('the record ring and the reticle', () => {
  it('rings the record outside the dot and its surface ring', () => {
    const inner = RECORD_RING_RADIUS - chartStroke.ring / 2;
    expect(inner).toBeGreaterThanOrEqual(dotDisks().ring);
  });

  it('draws four ticks round the point, each clear of the record ring', () => {
    const ticks = reticleTicks({ x: 100, y: 50 });
    expect(ticks).toHaveLength(4);
    for (const { from, to } of ticks) {
      const near = Math.hypot(from.x - 100, from.y - 50);
      const far = Math.hypot(to.x - 100, to.y - 50);
      expect(near).toBe(RETICLE_INNER);
      expect(near).toBeGreaterThan(RECORD_RING_RADIUS + chartStroke.ring / 2);
      expect(far).toBeGreaterThan(near);
    }
    const directions = ticks.map(({ from }) => [Math.sign(from.x - 100), Math.sign(from.y - 50)]);
    expect(directions).toEqual([
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]);
  });
});

describe('staircasePoints', () => {
  it('holds each record level until the next one, then steps', () => {
    const steps = [
      { x: 0, y: 40 },
      { x: 10, y: 30 },
      { x: 25, y: 12 },
    ];
    expect(staircasePoints(steps)).toEqual([
      { x: 0, y: 40 },
      { x: 10, y: 40 },
      { x: 10, y: 30 },
      { x: 25, y: 30 },
      { x: 25, y: 12 },
    ]);
  });

  it('carries the newest record flat to the right edge', () => {
    expect(staircasePoints([{ x: 5, y: 20 }], 300)).toEqual([
      { x: 5, y: 20 },
      { x: 300, y: 20 },
    ]);
  });

  it('draws nothing for no records', () => {
    expect(staircasePoints([], 300)).toEqual([]);
  });
});

describe('triangleSvg', () => {
  it('is an 8px triangle centred on the point', () => {
    expect(triangleSvg({ x: 10, y: 10 })).toBe('M10 6L14 14L6 14Z');
  });
});
