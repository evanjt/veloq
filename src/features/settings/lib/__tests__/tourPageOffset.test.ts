import { tourPageOffset } from '@/features/settings/lib/tourPageOffset';

describe('tourPageOffset', () => {
  it('shifts the row one card width left per slide', () => {
    expect(tourPageOffset(2, 300)).toBe(-600);
  });

  it('leaves the first slide at the origin', () => {
    expect(tourPageOffset(0, 300)).toBe(-0);
  });

  it('follows the width, so a narrower card gives a smaller offset for the same slide', () => {
    expect(tourPageOffset(2, 200)).toBe(-400);
  });
});
