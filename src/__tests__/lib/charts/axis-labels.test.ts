import { axisLabelTops, niceScale } from '@/shared/charts/axisLabels';

describe('axisLabelTops', () => {
  it('centres each label on its value', () => {
    expect(axisLabelTops([0, 500, 1000], [0, 1000], { top: 4, bottom: 180 }, 12)).toEqual([
      174, 86, -2,
    ]);
  });

  it('puts zero a third of the way down a domain running from -60 to 30', () => {
    const [zeroTop] = axisLabelTops([0], [-60, 30], { top: 0, bottom: 90 }, 0);
    expect(zeroTop).toBe(30);
  });

  it('places nothing for no ticks', () => {
    expect(axisLabelTops([], [0, 1], { top: 0, bottom: 100 }, 12)).toEqual([]);
  });

  it('puts every label at the start of a zero-width domain', () => {
    expect(axisLabelTops([5, 5], [5, 5], { top: 10, bottom: 110 }, 10)).toEqual([105, 105]);
  });
});

describe('niceScale', () => {
  it('rounds the ends out to a step of 1, 2 or 5 times a power of ten', () => {
    expect(niceScale([0, 55.55], 3)).toEqual({ domain: [0, 60], ticks: [0, 20, 40, 60], step: 20 });
    expect(niceScale([212, 287], 2)).toEqual({
      domain: [200, 300],
      ticks: [200, 250, 300],
      step: 50,
    });
  });

  it('keeps an extent that already sits on its steps', () => {
    expect(niceScale([0, 100], 2).domain).toEqual([0, 100]);
  });

  it('prints fractional steps without floating point residue', () => {
    expect(niceScale([0, 0.7], 4).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });

  it('opens a flat extent onto zero', () => {
    expect(niceScale([0, 0], 2).domain).toEqual([0, 1]);
    expect(niceScale([40, 40], 2).domain).toEqual([0, 40]);
    expect(niceScale([-40, -40], 2).domain).toEqual([-40, 0]);
  });

  it('spans zero for a domain that crosses it', () => {
    const { domain, ticks } = niceScale([-35, 30], 3);
    expect(domain[0]).toBeLessThanOrEqual(-35);
    expect(domain[1]).toBeGreaterThanOrEqual(30);
    expect(ticks).toContain(0);
  });

  it('falls back to the unit range when the extent is not finite', () => {
    expect(niceScale([Infinity, -Infinity], 2).domain).toEqual([0, 1]);
  });
});
