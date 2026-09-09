import { gaussianSmooth } from '@/shared/math/smoothing';

describe('gaussianSmooth', () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = [10, 20, 30, 40, 50];

  it('produces the requested number of finite points', () => {
    const result = gaussianSmooth(xs, ys, 10);
    expect(result.length).toBe(10);
    result.forEach((pt) => {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
      expect(Number.isFinite(pt.std)).toBe(true);
    });
  });

  it.each([
    ['outputCount=1', 1],
    ['outputCount=0', 0],
  ])('clamps %s to 2 rather than dividing by zero', (_label, outputCount) => {
    const result = gaussianSmooth(xs, ys, outputCount);
    expect(result.length).toBe(2);
    result.forEach((pt) => {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
    });
  });

  it('returns empty for empty input', () => {
    expect(gaussianSmooth([], [], 10)).toEqual([]);
  });
});
