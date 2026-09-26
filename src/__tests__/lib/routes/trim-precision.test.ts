/**
 * Expected behaviour: the ladder is symmetric about the track and its
 * boundaries belong to the coarser level, so a finger resting exactly on one
 * does not chatter between two ratios.
 */
import { precisionLevel, precisionRatio } from '@/features/routes/lib/trimPrecision';

describe('the trim precision ladder', () => {
  it.each([
    [0, 'normal'],
    [19, 'normal'],
    [20, 'precision'],
    [59, 'precision'],
    [60, 'fine'],
    [400, 'fine'],
  ])('reads %p as %p', (dy, level) => {
    expect(precisionLevel(dy)).toBe(level);
  });

  it('is symmetric about the track', () => {
    for (const dy of [0, 19, 20, 59, 60, 400]) {
      expect(precisionLevel(-dy)).toBe(precisionLevel(dy));
      expect(precisionRatio(-dy)).toBe(precisionRatio(dy));
    }
  });

  it('slows the handle as the finger moves away', () => {
    expect(precisionRatio(0)).toBe(1);
    expect(precisionRatio(30)).toBe(0.25);
    expect(precisionRatio(100)).toBe(0.125);
  });
});
