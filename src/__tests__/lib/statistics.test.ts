import { median } from '@/shared/math/statistics';

describe('median', () => {
  it('returns 0 for an empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns the middle value for an odd count', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([5])).toBe(5);
  });

  it('averages the two middle values for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([4, 1])).toBe(2.5);
  });

  it('sorts numerically, not lexically', () => {
    // A default `.sort()` orders these as 10, 100, 9 and returns 100.
    expect(median([100, 9, 10])).toBe(10);
  });

  it('does not mutate the caller array', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it('handles negatives and zero', () => {
    expect(median([-5, -1, -3])).toBe(-3);
    expect(median([-2, 2])).toBe(0);
  });
});
