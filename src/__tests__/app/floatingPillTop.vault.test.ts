/**
 * Expected behaviour: a floating pill starts `spacing.xs` below the status bar, or
 * below the banners in the top slot when they reach further down, and the header a
 * screen draws does not move it, since the pill floats over that header.
 */
import { floatingPillTop } from '@/shared/app/TopSafeAreaContext';
import { spacing } from '@/theme';

describe('floatingPillTop', () => {
  it('starts below the status bar when the slot is empty', () => {
    expect(floatingPillTop(47, 0)).toBe(47 + spacing.xs);
  });

  it('starts below the banner slot when it reaches past the status bar', () => {
    expect(floatingPillTop(47, 56)).toBe(56 + spacing.xs);
  });

  it('starts below the status bar when the slot is shorter than the inset', () => {
    expect(floatingPillTop(47, 20)).toBe(47 + spacing.xs);
  });

  it('starts below the slot on a device with no inset', () => {
    expect(floatingPillTop(0, 0)).toBe(spacing.xs);
    expect(floatingPillTop(0, 80)).toBe(80 + spacing.xs);
  });
});
